import type { VideoPlanInput } from "../../../src/shared/plan/schema";

/**
 * Hand-written sample plan. Uses every scene type and both explicit and
 * default cues. Used by the Studio preview, the Root default props and tests.
 */
let n = 0;
const say = (...texts: string[]) => texts.map((text) => ({ id: `s${++n}`, text }));

export const SAMPLE_PLAN: VideoPlanInput = {
	version: 1,
	meta: { title: "How a Web Page Reaches You", level: "Grade 9", style: "clean", fps: 30, width: 1920, height: 1080 },
	chapters: [
		{
			id: "intro",
			title: "Introduction",
			scenes: [
				{
					id: "title",
					type: "title",
					props: { kicker: "Computer Science · Grade 9", title: "How a Web Page Reaches You", subtitle: "From typing an address to seeing the page, in under a second" },
					narration: say("You type an address, press Enter, and a page appears almost instantly.", "But a lot happens in that one second."),
				},
				{
					id: "goals",
					type: "bullets",
					props: {
						heading: "What you will learn",
						items: ["How your browser finds the right computer", "How the page travels in small packets", "Why some connections are faster than others", "How a program asks for a page"],
					},
					narration: say(
						"In this video, we will follow one web page on its journey.",
						"First, how your browser finds the computer that holds the page.",
						"Then, how the page is cut into packets that travel across the internet.",
						"We will compare connection types, and finish by reading a tiny program that asks for a page.",
					),
					cues: [
						{ at: 1, action: "reveal", target: 0 },
						{ at: 2, action: "reveal", target: 1 },
						{ at: 3, action: "reveal", target: 2 },
						{ at: 3, edge: "start", offsetMs: 1800, action: "reveal", target: 3 },
					],
				},
			],
		},
		{
			id: "finding",
			title: "Finding the server",
			scenes: [
				{
					id: "ch1",
					type: "chapter",
					props: { number: 1, title: "Finding the server", goal: "Names are for people. Numbers are for computers." },
					narration: say("Chapter one. Finding the server."),
				},
				{
					id: "dns",
					type: "definition",
					props: {
						term: "DNS",
						partOfSpeech: "Domain Name System",
						definition: "The internet's phone book. It turns a name like example.com into an IP address, the number computers use to find each other.",
						example: "example.com  →  93.184.215.14",
					},
					narration: say(
						"Computers do not understand names like example dot com.",
						"They use numbers called IP addresses.",
						"DNS is like a phone book: you give it a name, and it gives you back the number.",
					),
				},
				{
					id: "steps",
					type: "flow",
					props: {
						heading: "One request, four steps",
						steps: [
							{ label: "Browser", detail: "You type the address" },
							{ label: "DNS", detail: "Name becomes a number" },
							{ label: "Server", detail: "Finds the page" },
							{ label: "Browser", detail: "Draws the page" },
						],
					},
					narration: say(
						"Here is the whole trip.",
						"Your browser asks DNS for the number of the website.",
						"With that number, it sends a request to the server, which finds the page.",
						"The server sends the page back, and your browser draws it on the screen.",
					),
				},
			],
		},
		{
			id: "travel",
			title: "Packets on the move",
			scenes: [
				{
					id: "ch2",
					type: "chapter",
					props: { number: 2, title: "Packets on the move", goal: "Big files travel as many small pieces." },
					narration: say("Chapter two. Packets on the move."),
				},
				{
					id: "tcp-udp",
					type: "compare",
					props: {
						heading: "Two ways to send packets",
						left: { title: "TCP", points: ["Checks every packet arrived", "Resends lost packets", "Used for web pages and email"] },
						right: { title: "UDP", points: ["Sends and does not check", "Faster, but can lose packets", "Used for video calls and games"] },
						verdict: "Web pages use TCP, because a missing piece would break the page.",
					},
					narration: say(
						"Packets can be sent in two main ways.",
						"TCP is careful: it checks that every packet arrived, and resends any that got lost.",
						"UDP is quick: it sends packets and does not wait to check.",
						"That is why web pages use TCP, but video calls often use UDP.",
					),
					cues: [
						{ at: 1, action: "reveal", target: 0 },
						{ at: 2, action: "reveal", target: 1 },
					],
				},
				{
					id: "speed",
					type: "chart",
					props: {
						heading: "Time to load a 2 MB page",
						kind: "bar",
						unit: "s",
						data: [
							{ label: "Dial-up", value: 290 },
							{ label: "3G", value: 8 },
							{ label: "4G", value: 1.6 },
							{ label: "Fibre", value: 0.2 },
						],
						highlight: 0,
					},
					narration: say(
						"Connection speed makes a huge difference.",
						"On old dial-up, a two megabyte page took almost five minutes.",
						"On 3G it takes about eight seconds, and on 4G under two.",
						"On fibre, it is just a fifth of a second.",
					),
				},
				{
					id: "code",
					type: "code",
					props: {
						heading: "Asking for a page in Python",
						language: "python",
						code: 'import requests\n\n# Ask the server for the page\nresponse = requests.get("https://example.com")\n\n# 200 means "OK, here it is"\nprint(response.status_code)\nprint(response.text[:80])',
						steps: [
							{ lines: [1, 1], note: "Load a library that knows how to talk to web servers." },
							{ lines: [3, 4], note: "Send a request. DNS, TCP and packets all happen inside this one line." },
							{ lines: [6, 8], note: "Check the status code, then print the start of the page." },
						],
					},
					narration: say(
						"Programs can ask for pages too.",
						"This Python program loads the requests library.",
						"One line sends the request: all the DNS and packet work happens inside it.",
						"Finally, it prints the status code, where 200 means OK, and the start of the page.",
					),
					cues: [
						{ at: 1, action: "focus", target: 0 },
						{ at: 2, action: "focus", target: 1 },
						{ at: 3, action: "focus", target: 2 },
					],
				},
			],
		},
		{
			id: "wrap",
			title: "Recap",
			scenes: [
				{
					id: "recap",
					type: "bullets",
					props: {
						heading: "Recap",
						items: ["DNS turns names into IP addresses", "Pages travel as packets", "TCP checks, UDP is quick", "Faster links load pages sooner"],
					},
					narration: say(
						"Let's recap.",
						"DNS turns a name into a number.",
						"The page travels as packets, usually over TCP.",
						"And a faster connection means the page arrives sooner. Thanks for watching!",
					),
				},
			],
		},
	],
};
