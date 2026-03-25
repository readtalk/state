import {
	type Connection,
	Server,
	type WSMessage,
	routePartykitRequest,
} from "partyserver";

import type { ChatMessage, Message, User, ProfileUpdate, ProfileUpdateResponse } from "../shared";

export class Chat extends Server<Env> {
	static options = { hibernate: true };

	messages = [] as ChatMessage[];
	users = new Map<string, User>(); // cache users in memory

	// ============================================================
	// DATABASE INITIALIZATION
	// ============================================================

	onStart() {
		// Create messages table
		this.ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS messages (
				id TEXT PRIMARY KEY, 
				user TEXT, 
				role TEXT, 
				content TEXT
			)`
		);

		// Create users table for identity
		this.ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS users (
				userId TEXT PRIMARY KEY,
				email TEXT UNIQUE,
				displayName TEXT,
				username TEXT UNIQUE,
				lastUsernameChange INTEGER,
				createdAt INTEGER
			)`
		);

		// Load existing messages
		this.messages = this.ctx.storage.sql
			.exec(`SELECT * FROM messages`)
			.toArray() as ChatMessage[];

		// Load existing users into memory cache
		const users = this.ctx.storage.sql
			.exec(`SELECT * FROM users`)
			.toArray() as User[];
		
		for (const user of users) {
			this.users.set(user.userId, user);
		}
	}

	// ============================================================
	// USER MANAGEMENT
	// ============================================================

	private getUser(userId: string): User | undefined {
		return this.users.get(userId);
	}

	private saveUser(user: User) {
		this.users.set(user.userId, user);
		this.ctx.storage.sql.exec(
			`INSERT INTO users (userId, email, displayName, username, lastUsernameChange, createdAt)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT (userId) DO UPDATE SET
			 displayName = excluded.displayName,
			 username = excluded.username,
			 lastUsernameChange = excluded.lastUsernameChange`,
			user.userId,
			user.email,
			user.displayName,
			user.username,
			user.lastUsernameChange,
			user.createdAt
		);
	}

	private isUsernameAvailable(username: string, excludeUserId?: string): boolean {
		const existing = Array.from(this.users.values()).find(
			u => u.username === username && u.userId !== excludeUserId
		);
		return !existing;
	}

	private canChangeUsername(user: User): boolean {
		const daysSince = (Date.now() - user.lastUsernameChange) / (1000 * 60 * 60 * 24);
		return daysSince >= 60; // 60 hari
	}

	// ============================================================
	// SEARCH FUNCTION
	// ============================================================

	private searchUsers(query: string): { userId: string; displayName: string; username: string }[] {
		const lowerQuery = query.toLowerCase();
		const results = Array.from(this.users.values()).filter(user => 
			user.displayName.toLowerCase().includes(lowerQuery) ||
			user.username.toLowerCase().includes(lowerQuery)
		);
		
		return results.map(user => ({
			userId: user.userId,
			displayName: user.displayName,
			username: user.username
		}));
	}

	// ============================================================
	// WEBSOCKET HANDLERS
	// ============================================================

	onConnect(connection: Connection) {
		// Send existing messages
		connection.send(
			JSON.stringify({
				type: "all",
				messages: this.messages,
			} satisfies Message)
		);
	}

	saveMessage(message: ChatMessage) {
		const existingMessage = this.messages.find((m) => m.id === message.id);
		if (existingMessage) {
			this.messages = this.messages.map((m) => {
				if (m.id === message.id) {
					return message;
				}
				return m;
			});
		} else {
			this.messages.push(message);
		}

		this.ctx.storage.sql.exec(
			`INSERT INTO messages (id, user, role, content) VALUES (?, ?, ?, ?)
			 ON CONFLICT (id) DO UPDATE SET content = ?`,
			message.id,
			message.user,
			message.role,
			message.content,
			message.content,
		);
	}

	onMessage(connection: Connection, message: WSMessage) {
		const parsed = JSON.parse(message as string);
		
		// Handle profile update
		if (parsed.type === "update_profile") {
			const update = parsed as ProfileUpdate;
			const userId = connection.id; // assuming connection.id is userId
			const user = this.getUser(userId);
			
			if (!user) {
				connection.send(JSON.stringify({
					type: "profile_updated",
					success: false,
					message: "User not found"
				} as ProfileUpdateResponse));
				return;
			}

			let response: ProfileUpdateResponse = { type: "profile_updated", success: true };

			// Handle displayName update (always allowed)
			if (update.displayName !== undefined && update.displayName !== user.displayName) {
				user.displayName = update.displayName;
				response.field = "displayName";
				response.newValue = update.displayName;
			}

			// Handle username update (with 60-day cooldown)
			if (update.username !== undefined && update.username !== user.username) {
				if (!this.canChangeUsername(user)) {
					const daysLeft = 60 - Math.floor((Date.now() - user.lastUsernameChange) / (1000 * 60 * 60 * 24));
					connection.send(JSON.stringify({
						type: "profile_updated",
						success: false,
						message: `Username can only be changed every 60 days. ${daysLeft} days remaining.`,
						field: "username",
						nextAllowedChange: user.lastUsernameChange + (60 * 24 * 60 * 60 * 1000)
					} as ProfileUpdateResponse));
					return;
				}

				if (!this.isUsernameAvailable(update.username, user.userId)) {
					connection.send(JSON.stringify({
						type: "profile_updated",
						success: false,
						message: "Username already taken",
						field: "username"
					} as ProfileUpdateResponse));
					return;
				}

				user.username = update.username;
				user.lastUsernameChange = Date.now();
				response.field = "username";
				response.newValue = update.username;
				response.nextAllowedChange = user.lastUsernameChange + (60 * 24 * 60 * 60 * 1000);
			}

			// Save updated user
			this.saveUser(user);
			
			connection.send(JSON.stringify(response));
			return;
		}

		// Handle search
		if (parsed.type === "search") {
			const results = this.searchUsers(parsed.query);
			connection.send(JSON.stringify({
				type: "search_results",
				results
			}));
			return;
		}

		// Handle new user registration (first time connection)
		if (parsed.type === "register") {
			const { userId, email, displayName, username } = parsed;
			
			// Check if username is available
			if (!this.isUsernameAvailable(username)) {
				connection.send(JSON.stringify({
					type: "register_response",
					success: false,
					message: "Username already taken"
				}));
				return;
			}

			const newUser: User = {
				userId,
				email,
				displayName: displayName || email.split('@')[0],
				username,
				lastUsernameChange: Date.now(),
				createdAt: Date.now()
			};

			this.saveUser(newUser);
			
			connection.send(JSON.stringify({
				type: "register_response",
				success: true,
				user: newUser
			}));
			return;
		}

		// Handle regular chat messages (existing functionality)
		this.broadcast(message);
		
		const msg = parsed as Message;
		if (msg.type === "add" || msg.type === "update") {
			this.saveMessage(msg);
		}
	}
}

export default {
	async fetch(request, env) {
		return (
			(await routePartykitRequest(request, { ...env })) ||
			env.ASSETS.fetch(request)
		);
	},
} satisfies ExportedHandler<Env>;
