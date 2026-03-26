import { createRoot } from "react-dom/client";
import { usePartySocket } from "partysocket/react";
import React, { useState, useEffect, useRef } from "react";
import {
	BrowserRouter,
	Routes,
	Route,
	Navigate,
	useParams,
} from "react-router";
import { nanoid } from "nanoid";

import { type ChatMessage, type Message, type User, type SearchResult } from "../shared";

function useUser() {
	const [user, setUser] = useState<User | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const userId = localStorage.getItem("readtalk_user_id");
		const email = localStorage.getItem("readtalk_email");
		const displayName = localStorage.getItem("readtalk_displayName");
		const username = localStorage.getItem("readtalk_username");
		const lastUsernameChange = localStorage.getItem("readtalk_lastUsernameChange");
		const createdAt = localStorage.getItem("readtalk_createdAt");

		if (userId && email) {
			setUser({
				userId,
				email,
				displayName: displayName || email.split("@")[0],
				username: username || email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "_").slice(0, 15),
				lastUsernameChange: parseInt(lastUsernameChange || Date.now().toString()),
				createdAt: parseInt(createdAt || Date.now().toString()),
			});
		}
		setLoading(false);
	}, []);

	const updateUser = (updatedUser: User) => {
		localStorage.setItem("readtalk_displayName", updatedUser.displayName);
		localStorage.setItem("readtalk_username", updatedUser.username);
		localStorage.setItem("readtalk_lastUsernameChange", updatedUser.lastUsernameChange.toString());
		setUser(updatedUser);
	};

	return { user, loading, updateUser };
}

function App() {
	const { user, loading, updateUser } = useUser();
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [inputValue, setInputValue] = useState("");
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const { room } = useParams();
	const registeredRef = useRef(false);
	const messagesEndRef = useRef<HTMLDivElement>(null);

	const effectiveRoom = room || (user ? user.userId : nanoid());

	const socket = usePartySocket({
		party: "chat",
		room: effectiveRoom,
		onMessage: (evt) => {
			const message = JSON.parse(evt.data as string);
						
			if (message.type === "register_response") {
				if (message.success && user) {
					updateUser(message.user);
				}
				return;
			}
					
			if (message.type === "profile_updated") {
				if (message.success && user) {
					if (message.field === "displayName") {
						updateUser({ ...user, displayName: message.newValue });
					} else if (message.field === "username") {
						updateUser({ ...user, username: message.newValue, lastUsernameChange: Date.now() });
					}
				} else if (!message.success) {
					console.error(message.message);
				}
				return;
			}

			if (message.type === "search_results") {
				setSearchResults(message.results);
				return;
			}

			const msg = message as Message;
			if (msg.type === "add") {
				const foundIndex = messages.findIndex((m) => m.id === msg.id);
				if (foundIndex === -1) {
					setMessages((prev) => [
						...prev,
						{
							id: msg.id,
							content: msg.content,
							user: msg.user,
							role: msg.role,
						},
					]);
				} else {
					setMessages((prev) => {
						return prev
							.slice(0, foundIndex)
							.concat({
								id: msg.id,
								content: msg.content,
								user: msg.user,
								role: msg.role,
							})
							.concat(prev.slice(foundIndex + 1));
					});
				}
			} else if (msg.type === "update") {
				setMessages((prev) =>
					prev.map((m) =>
						m.id === msg.id
							? {
									id: msg.id,
									content: msg.content,
									user: msg.user,
									role: msg.role,
								}
							: m
					)
				);
			} else if (msg.type === "all") {
				setMessages(msg.messages);
			}
		},
	});

	useEffect(() => {
		if (socket && user && !registeredRef.current) {
			socket.send(
				JSON.stringify({
					type: "register",
					userId: user.userId,
					email: user.email,
					displayName: user.displayName,
					username: user.username,
				})
			);
			registeredRef.current = true;
		}
	}, [socket, user]);

	useEffect(() => {
		if (messagesEndRef.current) {
			messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
		}
	}, [messages]);

	// Kirim hasil pencarian ke HTML
	useEffect(() => {
		window.dispatchEvent(new CustomEvent('searchResults', { detail: { results: searchResults } }));
	}, [searchResults]);

	// Listener dari HTML
	useEffect(() => {
		const handleSearch = (e: CustomEvent) => {
			const query = e.detail.query;
			if (query && query.trim()) {
				socket.send(JSON.stringify({ type: "search", query: query.trim() }));
			}
		};
		
		const handleSaveSettings = (e: CustomEvent) => {
			const updates = e.detail;
			if (updates.displayName || updates.username) {
				socket.send(JSON.stringify({ type: "update_profile", ...updates }));
			}
		};
		
		const handleStartChat = (e: CustomEvent) => {
			const { userId: targetUserId } = e.detail;
			// TODO: implement start chat with targetUserId
			console.log("Start chat with:", targetUserId);
		};
		
		window.addEventListener('search', handleSearch as EventListener);
		window.addEventListener('saveSettings', handleSaveSettings as EventListener);
		window.addEventListener('startChat', handleStartChat as EventListener);
		
		return () => {
			window.removeEventListener('search', handleSearch as EventListener);
			window.removeEventListener('saveSettings', handleSaveSettings as EventListener);
			window.removeEventListener('startChat', handleStartChat as EventListener);
		};
	}, [socket]);

	if (loading) {
		return <div className="chat container">Loading...</div>;
	}

	const isInputEmpty = inputValue.trim() === "";
	const sendButtonIcon = isInputEmpty ? "●" : "➤";

	return (
		<div className="chat container">
			{messages.map((message) => (
				<div key={message.id} className="row message">
					<div className="two columns user">
						{message.user === (user?.displayName || user?.username) ? "You" : message.user}
					</div>
					<div className="ten columns">{message.content}</div>
				</div>
			))}
			<div ref={messagesEndRef} />
			<form
				className="row"
				onSubmit={(e) => {
					e.preventDefault();
					if (isInputEmpty) {
						console.log("Voice note not implemented yet");
						return;
					}
					
					const chatMessage: ChatMessage = {
						id: nanoid(8),
						content: inputValue,
						user: user?.displayName || user?.username || "Anonymous",
						role: "user",
					};
					setMessages((prev) => [...prev, chatMessage]);

					socket.send(
						JSON.stringify({
							type: "add",
							...chatMessage,
						} satisfies Message)
					);

					setInputValue("");
				}}
			
				<input
					type="text"
					name="content"
					className="ten columns my-input-text"
					placeholder={`Hello ${user?.displayName || user?.username || "User"}! Type a message...`}
					autoComplete="off"
					value={inputValue}
					onChange={(e) => setInputValue(e.target.value)}
				/>
				<button type="submit" className="send-message two columns">
					{sendButtonIcon}
				</button>
			</form>
		</div>
	);
}

createRoot(document.getElementById("root")!).render(
	<BrowserRouter>
		<Routes>
			<Route path="/" element={<Navigate to={`/${nanoid()}`} />} />
			<Route path="/:room" element={<App />} />
			<Route path="*" element={<Navigate to="/" />} />
		</Routes>
	</BrowserRouter>
);
