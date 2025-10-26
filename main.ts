const BLUE_600 = "#2563eb";
const RED_500 = "#ef4444";

const getBranch = new Deno.Command("git", {
	args: ["branch"],
});

const gitBranchLog = (branch: string) =>
	new Deno.Command("git", {
		args: ["log", "--pretty=format:%H|%an|%ad|%s", "--name-status", branch],
	});

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
	day: "2-digit",
	month: "short",
	year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});

type ChangedFile = {
	name: string;
	status: "A" | "M" | "D" | "R" | "C";
	oldName?: string;
};

type Commit = {
	hash: string;
	username: string;
	date: string;
	time: string;
	message: string;
	files: ChangedFile[];
	isExpanded: boolean;
};

function getLongestLineLength(commits: Commit[]) {
	let maxCharacters = 0;
	commits.forEach((commit) => {
		const line = `${commit.date} ${commit.time} | ${commit.username} | ${commit.message}`;
		if (line.length > maxCharacters) maxCharacters = line.length;
	});

	return maxCharacters;
}

function getLongestFilenameLength(files: ChangedFile[]) {
	let maxCharacters = 0;
	files.forEach((file) => {
		if (file.name.length > maxCharacters) {
			maxCharacters = file.name.length;
		}
	});

	return maxCharacters;
}

function getFileIcon(filename: string) {
	const extension = filename.split(".").at(-1);

	switch (extension) {
		case "js":
			return "\x1b[48;5;11m JS\x1b[0m";
		case "jsx":
			return "\x1b[38;5;39m ⚛ \x1b[0m";
		case "ts":
			return "\x1b[48;5;27m TS\x1b[0m";
		case "tsx":
			return "\x1b[38;5;39m ⚛ \x1b[0m";
		case "css":
			return "\x1b[38;5;39m # \x1b[0m";
		case "json":
			return "\x1b[38;5;92m{…}\x1b[0m";
		case "gitignore":
			return "\x1b[38;5;9m ⎇ \x1b[0m";
		default:
			return "⎕";
	}
}

function foreground(code: number) {
	return `\x1b[38;5;${code}m`;
}

function foregroundHex(hexCode: `#${string[6]}`) {
	return `color: ${hexCode};`;
}

function background(hexCode: `#${string[6]}`) {
	return `background-color: ${hexCode};`;
}

function getHighlightedFilename(
	file: ChangedFile,
	nameLength: number,
	lineLength: number,
) {
	const fileName = file.name.padEnd(nameLength, " ");
	const fileInfo =
		file.status === "R" ? `${fileName}    ← ${file.oldName}` : fileName;

	switch (file.status) {
		case "A":
			return `${foreground(78)}${fileInfo.padEnd(lineLength - 4, " ")}${file.status}${foreground(0)}`;
		case "M":
			return `${fileInfo.padEnd(lineLength - 4, " ")}${file.status}`;
		case "D":
			// return `${foreground(210)}${fileInfo.padEnd(lineLength - 4, " ")}${file.status}${foreground(0)}`;
			return `${foreground(210)}${fileInfo.padEnd(lineLength - 4, " ")}${file.status}${foreground(0)}`;
		case "R":
			return `${foreground(75)}${fileInfo.padEnd(lineLength - 4, " ")}${file.status}${foreground(0)}`;
		default:
			return fileName;
	}
}

function renderList(commits: Commit[], selectedIndex: number) {
	console.clear();
	console.log(
		"\nⓘ  Use ↑/↓ to navigate, Space to expand/collapse, Ctrl+C to exit\n",
	);

	const lineLength = getLongestLineLength(commits);

	commits.forEach((commit, index) => {
		const isSelected = index === selectedIndex;
		const expandMarker = commit.isExpanded ? "[-]" : "[+]";
		const line =
			`${commit.date} ${commit.time} | ${commit.username} | ${commit.message}`.padEnd(
				lineLength,
				" ",
			);

		if (isSelected) {
			console.log(`%c  ${expandMarker} ${line}  `, background(BLUE_600));
		} else {
			console.log(`  ${expandMarker} ${line}  `);
		}

		if (commit.isExpanded) {
			const nameLength = getLongestFilenameLength(commit.files);

			commit.files.forEach((file) => {
				const icon = getFileIcon(file.name);
				const fileInfo = getHighlightedFilename(file, nameLength, lineLength);

				console.log(`      ${icon} ${fileInfo}`);
			});
		}
	});
}

async function interactiveList(commits: Commit[]) {
	let selectedIndex = 0;

	// Set raw mode to capture individual key presses
	Deno.stdin.setRaw(true);

	renderList(commits, selectedIndex);

	const buffer = new Uint8Array(8);

	try {
		while (true) {
			const n = await Deno.stdin.read(buffer);
			if (n === null) break;

			const bytes = buffer.subarray(0, n);

			// Ctrl+C (0x03)
			if (bytes[0] === 3) {
				break;
			}

			// Space (0x20)
			if (bytes[0] === 32) {
				commits[selectedIndex].isExpanded = !commits[selectedIndex].isExpanded;
				renderList(commits, selectedIndex);
			}

			// Arrow keys (escape sequences)
			// Up arrow: [27, 91, 65]
			if (bytes[0] === 27 && bytes[1] === 91 && bytes[2] === 65) {
				selectedIndex = Math.max(0, selectedIndex - 1);
				renderList(commits, selectedIndex);
			}

			// Down arrow: [27, 91, 66]
			if (bytes[0] === 27 && bytes[1] === 91 && bytes[2] === 66) {
				selectedIndex = Math.min(commits.length - 1, selectedIndex + 1);
				renderList(commits, selectedIndex);
			}
		}
	} finally {
		// Restore normal terminal mode
		Deno.stdin.setRaw(false);
		console.log("\nExiting...");
	}
}

async function main() {
	const textDecoder = new TextDecoder();
	// create subprocess and collect output
	const gitBranchOutput = await getBranch.output();
	const branchesOutput = textDecoder.decode(gitBranchOutput.stdout);
	const branchesError = textDecoder.decode(gitBranchOutput.stderr);

	const branches = branchesOutput.split("\n");
	const currentBranch = branches
		.find((branch) => branch.includes("*"))
		?.slice(2);

	if (!currentBranch) {
		throw new Error("No current branch selected");
	}

	const gitBranchLogOutput = await gitBranchLog(currentBranch).output();
	const logOutput = textDecoder.decode(gitBranchLogOutput.stdout);
	const logError = textDecoder.decode(gitBranchLogOutput.stderr);

	const commitHistory = logOutput.split("\n\n").map((commit) => {
		const lines = commit.trimEnd().split("\n");
		const meta = lines[0].split("|");
		const datetime = new Date(meta[2]);

		const files = lines.slice(1).map((file) => {
			const res = file.split("\t");

			return {
				status: res[0][0] === "R" ? "R" : (res[0] as ChangedFile["status"]),
				name: res[1],
				oldName: res[2],
			};
		});

		return {
			hash: meta[0],
			username: meta[1],
			date: dateFormatter.format(datetime),
			time: timeFormatter.format(datetime),
			message: meta[3],
			files,
			isExpanded: false,
		};
	});

	await interactiveList(commitHistory);
}

main();
