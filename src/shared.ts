export type ChatMessage = {
	id: string;
	content: string;
	user: string;
	role: "user" | "assistant";
};

export type Message =
	| {
			type: "add";
			id: string;
			content: string;
			user: string;
			role: "user" | "assistant";
	  }
	| {
			type: "update";
			id: string;
			content: string;
			user: string;
			role: "user" | "assistant";
	  }
	| {
			type: "all";
			messages: ChatMessage[];
	  };

export const names = [
	"Alice",
	"Bob",
	"Charlie",
	"David",
	"Eve",
	"Frank",
	"Grace",
	"Heidi",
	"Ivan",
	"Judy",
	"Kevin",
	"Linda",
	"Mallory",
	"Nancy",
	"Oscar",
	"Peggy",
	"Quentin",
	"Randy",
	"Steve",
	"Trent",
	"Ursula",
	"Victor",
	"Walter",
	"Xavier",
	"Yvonne",
	"Zoe",
];

// ============================================================
// NEW TYPES FOR READTALK IDENTITY SYSTEM
// ============================================================

// User identity (localStorage & database)
export type User = {
	userId: string;              // dari OpenAuth, permanen
	email: string;               // dari OpenAuth, permanen
	displayName: string;         // Your Name, bisa edit kapan saja
	username: string;            // @yourname, bisa edit 1x per 60 hari
	lastUsernameChange: number;  // timestamp terakhir ganti username
	createdAt: number;           // timestamp akun dibuat
};

// Untuk search results (hanya data yang perlu ditampilkan)
export type SearchResult = {
	userId: string;
	displayName: string;
	username: string;
};

// Untuk update profile via WebSocket
export type ProfileUpdate = {
	type: "update_profile";
	displayName?: string;
	username?: string;
};

// Untuk response update profile
export type ProfileUpdateResponse = {
	type: "profile_updated";
	success: boolean;
	message?: string;
	field?: "displayName" | "username";
	newValue?: string;
	nextAllowedChange?: number; // untuk username, kapan bisa ganti lagi
};
