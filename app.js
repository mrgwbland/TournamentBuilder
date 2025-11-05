// Central store for tournament configuration, players, and rounds.
const state = {
    started: false,
    settings: {
        type: "swiss",
        pairingMethod: "dutch",
        optOutBye: 0.5,
        roundCount: 5
    },
    players: [],
    rounds: [],
    nextPlayerId: 1
};

let messageTimeout = null;

const resultOptions = [
    { value: "", label: "Select result" },
    { value: "1-0", label: "1 - 0 (White wins)" },
    { value: "0-1", label: "0 - 1 (Black wins)" },
    { value: "0.5-0.5", label: "1/2 - 1/2 (Draw)" }
];

document.addEventListener("DOMContentLoaded", () => {
    bindEventListeners();
    renderAll();
});

function bindEventListeners() {
    const addPlayerForm = document.getElementById("add-player-form");
    if (addPlayerForm) {
        addPlayerForm.addEventListener("submit", handleAddPlayer);
    }

    const playerListContainer = document.getElementById("player-list");
    if (playerListContainer) {
        playerListContainer.addEventListener("click", handleRemovePlayer);
    }

    const startButton = document.getElementById("start-btn");
    if (startButton) {
        startButton.addEventListener("click", startTournament);
    }

    const importSampleButton = document.getElementById("import-sample-btn");
    if (importSampleButton) {
        importSampleButton.addEventListener("click", importSamplePlayers);
    }
function importSamplePlayers() {
    if (state.started) {
        flashMessage("error", "Cannot import after tournament start.");
        return;
    }
    // Example set: 8 players, varied ratings
    const samples = [
        { name: "Attlee", rating: 2100 },
        { name: "Bormann", rating: 2050 },
        { name: "Churchill", rating: 2000 },
        { name: "De Gaulle", rating: 1950 },
        { name: "Eisenhower", rating: 1900 },
        { name: "Franco", rating: 1850 },
        { name: "Goering", rating: 1800 },
        { name: "Hitler", rating: 1750 }
    ];
    samples.forEach((sample) => {
        // Prevent duplicates
        if (!state.players.some((p) => p.name === sample.name)) {
            state.players.push({
                id: state.nextPlayerId++,
                name: sample.name,
                rating: sample.rating,
                initialSeed: state.players.length + 1,
                score: 0,
                matchesPlayed: 0,
                colorHistory: { white: 0, black: 0 },
                opponents: new Set(),
                fullByeCount: 0,
                optOutByeCount: 0,
                lastColor: null
            });
        }
    });
    flashMessage("success", "Sample players imported.");
    renderAll();
}

    document.addEventListener("submit", (event) => {
        if (event.target && event.target.id === "optout-form") {
            event.preventDefault();
            generateNextRound(new FormData(event.target));
        }
    });

    const roundsContainer = document.getElementById("rounds-container");
    if (roundsContainer) {
        roundsContainer.addEventListener("click", (event) => {
            const button = event.target.closest("button");
            if (!button) {
                return;
            }
            if (button.dataset.action === "save-round") {
                const roundNumber = Number(button.dataset.round);
                saveRoundResults(roundNumber);
            } else if (button.dataset.action === "edit-round") {
                const roundNumber = Number(button.dataset.round);
                toggleRoundEditing(roundNumber, true);
            }
        });
    }
}

function handleAddPlayer(event) {
    event.preventDefault();
    if (state.started) {
        flashMessage("error", "Tournament already started. Players can no longer be added.");
        return;
    }

    const nameInput = document.getElementById("player-name");
    const ratingInput = document.getElementById("player-rating");

    const name = nameInput.value.trim();
    const rating = Number(ratingInput.value);

    if (!name) {
        flashMessage("error", "Enter a player name.");
        return;
    }
    if (!Number.isFinite(rating)) {
        flashMessage("error", "Enter a valid rating.");
        return;
    }

    const newPlayer = {
        id: state.nextPlayerId++,
        name,
        rating,
        initialSeed: state.players.length + 1,
        score: 0,
        matchesPlayed: 0,
        colorHistory: { white: 0, black: 0 },
        opponents: new Set(),
        fullByeCount: 0,
        optOutByeCount: 0,
        lastColor: null
    };

    state.players.push(newPlayer);
    nameInput.value = "";
    ratingInput.value = "";
    flashMessage("success", `${name} added.`);
    renderAll();
}

function handleRemovePlayer(event) {
    const button = event.target.closest("button[data-remove-player]");
    if (!button) {
        return;
    }
    if (state.started) {
        flashMessage("error", "Cannot remove players after the tournament has started.");
        return;
    }
    const playerId = Number(button.dataset.removePlayer);
    state.players = state.players.filter((player) => player.id !== playerId);
    flashMessage("success", "Player removed.");
    renderAll();
}

function startTournament() {
    if (state.started) {
        return;
    }
    if (state.players.length < 2) {
        flashMessage("error", "Add at least two players to start the tournament.");
        return;
    }

    const typeSelect = document.getElementById("tournament-type");
    const pairingSelect = document.getElementById("pairing-method");
    const optOutSelect = document.getElementById("optout-points");
    const roundCountInput = document.getElementById("round-count");

    state.settings.type = typeSelect.value;
    state.settings.pairingMethod = pairingSelect.value;
    state.settings.optOutBye = Number(optOutSelect.value);
    state.settings.roundCount = Math.max(1, Number(roundCountInput.value));

    state.started = true;
    disableSetupControls();
    recalculatePlayerStats();
    flashMessage("success", "Tournament ready. Configure Round 1 opt-outs when ready.");
    renderAll();
}

function disableSetupControls() {
    const settingsForm = document.getElementById("settings-form");
    settingsForm.querySelectorAll("select, input, button").forEach((element) => {
        if (element.id !== "start-btn") {
            element.disabled = true;
        }
    });
    const startButton = document.getElementById("start-btn");
    startButton.disabled = true;

    const addPlayerForm = document.getElementById("add-player-form");
    addPlayerForm.querySelectorAll("input, button").forEach((element) => {
        element.disabled = true;
    });
}

function generateNextRound(formData) {
    if (!state.started) {
        flashMessage("error", "Start the tournament first.");
        return;
    }

    const pendingRound = state.rounds[state.rounds.length - 1];
    if (pendingRound && pendingRound.status !== "completed") {
        flashMessage("error", `Complete Round ${pendingRound.number} results before pairing the next round.`);
        return;
    }

    if (state.rounds.length >= state.settings.roundCount) {
        flashMessage("info", "All scheduled rounds have been generated.");
        return;
    }

    recalculatePlayerStats();

    const upcomingRoundNumber = state.rounds.length + 1;
    const optOutSelections = new Set(
        (formData.getAll("optout-player") || []).map((value) => Number(value))
    );

    const round = {
        number: upcomingRoundNumber,
        status: "pending",
        pairings: []
    };

    const allPlayers = state.players.slice();
    const optOutPlayers = allPlayers.filter((player) => optOutSelections.has(player.id));
    optOutPlayers.forEach((player) => {
        round.pairings.push({
            id: `round${upcomingRoundNumber}-optout-${player.id}`,
            type: "bye",
            playerId: player.id,
            reason: "opt-out",
            pointsAwarded: state.settings.optOutBye
        });
    });

    let activePlayers = allPlayers.filter((player) => !optOutSelections.has(player.id));

    if (activePlayers.length === 0) {
        if (!round.pairings.length) {
            flashMessage("error", "No players available for this round.");
            return;
        }
        state.rounds.push(round);
        recalculatePlayerStats();
        renderAll();
        flashMessage("success", `Round ${upcomingRoundNumber} recorded with opt-outs only.`);
        return;
    }

    let forcedByePlayer = null;
    if (activePlayers.length % 2 === 1) {
        forcedByePlayer = chooseForcedByeCandidate(activePlayers.slice());
        round.pairings.push({
            id: `round${upcomingRoundNumber}-bye-${forcedByePlayer.id}`,
            type: "bye",
            playerId: forcedByePlayer.id,
            reason: "forced-bye",
            pointsAwarded: 1
        });
        activePlayers = activePlayers.filter((player) => player.id !== forcedByePlayer.id);
    }

    if (activePlayers.length > 0) {
        const pairings = buildPairings(activePlayers, state.settings.pairingMethod);
        if (!pairings) {
            flashMessage("error", "Unable to create pairings without repeat opponents. Adjust opt-outs or previous results.");
            return;
        }
        const coloredPairings = assignColorsToPairs(pairings);
        coloredPairings.forEach((pair, index) => {
            round.pairings.push({
                id: `round${upcomingRoundNumber}-board-${index + 1}`,
                type: "match",
                board: index + 1,
                whiteId: pair.white.id,
                blackId: pair.black.id,
                result: null
            });
        });
    }

    if (!round.pairings.length) {
        flashMessage("error", "Failed to create round pairings.");
        return;
    }

    state.rounds.push(round);
    recalculatePlayerStats();
    renderAll();
    flashMessage("success", `Round ${upcomingRoundNumber} pairings generated.`);
}

function chooseForcedByeCandidate(players) {
    const ranked = players
        .slice()
        .sort((a, b) => {
            if (a.fullByeCount !== b.fullByeCount) {
                return a.fullByeCount - b.fullByeCount;
            }
            if (a.score !== b.score) {
                return a.score - b.score;
            }
            if (a.rating !== b.rating) {
                return a.rating - b.rating;
            }
            return a.name.localeCompare(b.name);
        });
    return ranked[0];
}

function buildPairings(players, method) {
    if (players.length % 2 !== 0) {
        return null;
    }

    const orderedPlayers = players
        .slice()
        .sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            if (b.rating !== a.rating) {
                return b.rating - a.rating;
            }
            return a.name.localeCompare(b.name);
        });

    const prepared = method === "dutch" ? prepareDutchEntries(orderedPlayers) : prepareMonradEntries(orderedPlayers);
    if (!prepared) {
        return null;
    }

    let result = backtrackPairs(prepared, method, []);

    if (!result && method === "dutch") {
        const relaxedEntries = prepareDutchRelaxedEntries(orderedPlayers);
        result = backtrackPairs(relaxedEntries, "dutch-relaxed", []);
    }

    return result;
}

function prepareDutchEntries(players) {
    const scoreGroups = groupPlayersByScore(players);
    const adjustedGroups = [];
    let carry = null;

    for (let index = 0; index < scoreGroups.length; index += 1) {
        const group = scoreGroups[index];
        let groupPlayers = group.players.slice();

        if (carry) {
            groupPlayers.push(carry);
            carry = null;
        }

        groupPlayers.sort(sortByRatingThenName);

        if (groupPlayers.length % 2 === 1) {
            carry = groupPlayers.pop();
        }

        if (groupPlayers.length) {
            adjustedGroups.push({ score: group.score, players: groupPlayers });
        }
    }

    if (carry) {
        const lastGroup = adjustedGroups[adjustedGroups.length - 1];
        if (!lastGroup) {
            return null;
        }
        lastGroup.players.push(carry);
        lastGroup.players.sort(sortByRatingThenName);
        if (lastGroup.players.length % 2 === 1) {
            return null;
        }
    }

    const entries = [];
    let runningIndex = 0;
    adjustedGroups.forEach((group, groupId) => {
        const size = group.players.length;
        const half = size / 2;
        const topHalf = group.players.slice(0, half);
        const bottomHalf = group.players.slice(half);

        topHalf.forEach((player, slot) => {
            entries.push({
                player,
                groupId,
                half: "top",
                slot,
                index: runningIndex,
                score: group.score
            });
            runningIndex += 1;
        });

        bottomHalf.forEach((player, slot) => {
            entries.push({
                player,
                groupId,
                half: "bottom",
                slot,
                index: runningIndex,
                score: group.score
            });
            runningIndex += 1;
        });
    });

    return entries;
}

function prepareMonradEntries(players) {
    return players.map((player, index) => ({
        player,
        groupId: 0,
        half: "any",
        slot: index,
        index,
        score: player.score
    }));
}

function prepareDutchRelaxedEntries(players) {
    return players.map((player, index) => ({
        player,
        groupId: 0,
        half: "any",
        slot: index,
        index,
        score: player.score
    }));
}

function groupPlayersByScore(players) {
    const groups = [];
    players.forEach((player) => {
        const scoreKey = Number((player.score ?? 0).toFixed(2));
        const lastGroup = groups[groups.length - 1];
        if (!lastGroup || lastGroup.score !== scoreKey) {
            groups.push({ score: scoreKey, players: [player] });
        } else {
            lastGroup.players.push(player);
        }
    });
    return groups;
}

function sortByRatingThenName(a, b) {
    if (b.rating !== a.rating) {
        return b.rating - a.rating;
    }
    return a.name.localeCompare(b.name);
}

function backtrackPairs(remaining, method, currentPairs) {
    if (!remaining.length) {
        return currentPairs;
    }

    const [first, ...rest] = remaining;
    const candidates = orderCandidates(first, rest, method);

    for (const candidate of candidates) {
        if (!candidate) {
            continue;
        }
        if (first.player.opponents.has(candidate.player.id)) {
            continue;
        }
        const filtered = rest.filter((entry) => entry !== candidate);
        const nextPairs = currentPairs.concat([[first.player, candidate.player]]);
        const solved = backtrackPairs(filtered, method, nextPairs);
        if (solved) {
            return solved;
        }
    }
    return null;
}

function orderCandidates(first, rest, method) {
    if (method === "dutch") {
        const primary = rest.filter((candidate) => candidate.groupId === first.groupId && candidate.half !== first.half);
        if (primary.length) {
            return primary.sort((a, b) => {
                const slotDiff = Math.abs(a.slot - first.slot) - Math.abs(b.slot - first.slot);
                if (slotDiff !== 0) {
                    return slotDiff;
                }
                return sortByRatingThenName(a.player, b.player);
            });
        }

        // Fallback: allow cross-group adjustments while keeping top vs bottom balance.
        return rest
            .filter((candidate) => candidate.half !== first.half)
            .sort((a, b) => {
                if (a.groupId !== b.groupId) {
                    return a.groupId - b.groupId;
                }
                const slotDiff = Math.abs(a.slot - first.slot) - Math.abs(b.slot - first.slot);
                if (slotDiff !== 0) {
                    return slotDiff;
                }
                return sortByRatingThenName(a.player, b.player);
            });
    }

    if (method === "dutch-relaxed") {
        return rest
            .slice()
            .sort((a, b) => {
                const scoreDiff = Math.abs(a.score - first.score) - Math.abs(b.score - first.score);
                if (scoreDiff !== 0) {
                    return scoreDiff;
                }
                return Math.abs(a.slot - first.slot) - Math.abs(b.slot - first.slot);
            });
    }

    if (method === "monrad") {
        return rest
            .slice()
            .sort((a, b) => Math.abs(a.index - first.index) - Math.abs(b.index - first.index));
    }

    return rest;
}

function assignColorsToPairs(pairs) {
    return pairs.map((pair, index) => {
        const [playerA, playerB] = pair;
        const statsA = getPlayerById(playerA.id);
        const statsB = getPlayerById(playerB.id);

        const balanceA = statsA.colorHistory.white - statsA.colorHistory.black;
        const balanceB = statsB.colorHistory.white - statsB.colorHistory.black;

        let white = playerA;
        let black = playerB;

        if (balanceA > balanceB) {
            white = playerB;
            black = playerA;
        } else if (balanceA === balanceB) {
            const lastA = statsA.lastColor;
            const lastB = statsB.lastColor;
            if (lastA === "white" && lastB !== "white") {
                white = playerB;
                black = playerA;
            } else if (lastB === "white" && lastA !== "white") {
                white = playerA;
                black = playerB;
            } else if (balanceA === balanceB) {
                if (statsA.colorHistory.white + statsA.colorHistory.black > statsB.colorHistory.white + statsB.colorHistory.black) {
                    white = playerB;
                    black = playerA;
                } else if (statsA.colorHistory.white + statsA.colorHistory.black === statsB.colorHistory.white + statsB.colorHistory.black) {
                    if (index % 2 === 1) {
                        white = playerB;
                        black = playerA;
                    }
                }
            }
        }

        return { white, black };
    });
}

function saveRoundResults(roundNumber) {
    const round = state.rounds.find((entry) => entry.number === roundNumber);
    if (!round) {
        return;
    }

    const matches = round.pairings.filter((pairing) => pairing.type === "match");
    const missingBoards = [];

    matches.forEach((pairing) => {
        const select = document.querySelector(`[data-result-for="${pairing.id}"]`);
        if (!select) {
            missingBoards.push(pairing.board);
            return;
        }
        const value = select.value;
        if (!value) {
            missingBoards.push(pairing.board);
            return;
        }
        pairing.result = value;
    });

    if (missingBoards.length) {
        flashMessage("error", `Select results for board(s): ${missingBoards.join(", ")}.`);
        return;
    }

    round.status = "completed";
    round.pairings
        .filter((pairing) => pairing.type === "bye")
        .forEach((pairing) => {
            pairing.result = "bye";
        });

    recalculatePlayerStats();
    renderAll();
    flashMessage("success", `Round ${roundNumber} results saved.`);
}

function toggleRoundEditing(roundNumber, enable) {
    const round = state.rounds.find((entry) => entry.number === roundNumber);
    if (!round) {
        return;
    }
    if (!enable) {
        round.status = "completed";
    } else {
        round.status = "pending";
    }
    renderAll();
}

// Replay all rounds to rebuild standings, colour history, and opponent sets.
function recalculatePlayerStats() {
    state.players.forEach((player) => {
        player.score = 0;
        player.matchesPlayed = 0;
        player.colorHistory = { white: 0, black: 0 };
        player.opponents = new Set();
        player.fullByeCount = 0;
        player.optOutByeCount = 0;
        player.lastColor = null;
    });

    state.rounds.forEach((round) => {
        round.pairings.forEach((pairing) => {
            if (pairing.type === "match") {
                const whitePlayer = getPlayerById(pairing.whiteId);
                const blackPlayer = getPlayerById(pairing.blackId);
                if (!whitePlayer || !blackPlayer) {
                    return;
                }

                whitePlayer.colorHistory.white += 1;
                blackPlayer.colorHistory.black += 1;
                whitePlayer.lastColor = "white";
                blackPlayer.lastColor = "black";

                whitePlayer.opponents.add(blackPlayer.id);
                blackPlayer.opponents.add(whitePlayer.id);

                if (round.status === "completed" && pairing.result) {
                    const [whiteScore, blackScore] = convertResultToPoints(pairing.result);
                    whitePlayer.score += whiteScore;
                    blackPlayer.score += blackScore;
                    whitePlayer.matchesPlayed += 1;
                    blackPlayer.matchesPlayed += 1;
                }
            } else if (pairing.type === "bye") {
                const byePlayer = getPlayerById(pairing.playerId);
                if (!byePlayer) {
                    return;
                }
                if (round.status === "completed") {
                    byePlayer.score += pairing.pointsAwarded;
                }
                if (pairing.reason === "forced-bye") {
                    byePlayer.fullByeCount += 1;
                } else if (pairing.reason === "opt-out") {
                    byePlayer.optOutByeCount += 1;
                }
            }
        });
    });
}

function convertResultToPoints(result) {
    switch (result) {
        case "1-0":
            return [1, 0];
        case "0-1":
            return [0, 1];
        case "0.5-0.5":
            return [0.5, 0.5];
        default:
            return [0, 0];
    }
}

function getPlayerById(id) {
    return state.players.find((player) => player.id === id);
}

function renderAll() {
    renderPlayers();
    renderOptOutSection();
    renderRounds();
    renderScoreboard();
}

function renderPlayers() {
    const container = document.getElementById("player-list");
    if (!container) {
        return;
    }

    if (!state.players.length) {
        container.innerHTML = "<p>No players added yet.</p>";
        return;
    }

    const rows = state.players
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((player) => {
            const removeCell = state.started
                ? ""
                : `<td><button data-remove-player="${player.id}">Remove</button></td>`;
            return `
                <tr>
                    <td>${player.name}</td>
                    <td>${player.rating}</td>
                    <td>${player.initialSeed}</td>
                    ${removeCell}
                </tr>
            `;
        })
        .join("");

    const headerCells = state.started ? "<th>Name</th><th>Rating</th><th>Seed</th>" : "<th>Name</th><th>Rating</th><th>Seed</th><th></th>";

    container.innerHTML = `
        <table>
            <thead>
                <tr>${headerCells}</tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
    `;
}

function renderOptOutSection() {
    const container = document.getElementById("optout-content");
    if (!container) {
        return;
    }

    if (!state.started) {
        container.innerHTML = "<p>Start the tournament to configure round pairings.</p>";
        return;
    }

    if (state.rounds.length >= state.settings.roundCount) {
        container.innerHTML = "<p>All rounds have been scheduled.</p>";
        return;
    }

    const pendingRound = state.rounds[state.rounds.length - 1];
    if (pendingRound && pendingRound.status !== "completed") {
        container.innerHTML = `<p class="warning">Complete Round ${pendingRound.number} before pairing the next round.</p>`;
        return;
    }

    const nextRoundNumber = state.rounds.length + 1;
    const playerCheckboxes = state.players
        .slice()
        .sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            if (b.rating !== a.rating) {
                return b.rating - a.rating;
            }
            return a.name.localeCompare(b.name);
        })
        .map((player) => {
            const scoreText = formatScore(player.score);
            return `
                <div class="optout-item">
                    <label>
                        <input type="checkbox" name="optout-player" value="${player.id}">
                        <span>${player.name} (Score: ${scoreText}, Rating: ${player.rating})</span>
                    </label>
                </div>
            `;
        })
        .join("");

    container.innerHTML = `
        <form id="optout-form">
            <p>Select any players sitting out Round ${nextRoundNumber}. Opt-outs will receive ${formatScore(state.settings.optOutBye)} point byes.</p>
            <div class="optout-list">
                ${playerCheckboxes || "<p>No players available.</p>"}
            </div>
            <div class="optout-actions">
                <button type="submit" class="primary">Generate Round ${nextRoundNumber} Pairings</button>
            </div>
        </form>
    `;
}

function renderRounds() {
    const container = document.getElementById("rounds-container");
    if (!container) {
        return;
    }

    if (!state.rounds.length) {
        container.innerHTML = "<p>No rounds generated yet.</p>";
        return;
    }

    // Hide previous rounds by default, show only the latest
    const latestRoundNumber = Math.max(...state.rounds.map(r => r.number));
    let showPrevious = window._showPreviousRounds || false;

    // Toggle button
    const toggleBtn = `<button id="toggle-rounds-btn" class="secondary" style="margin-bottom:10px;">${showPrevious ? "Hide" : "Show"} Previous Rounds</button>`;

    // Render rounds
    const cards = state.rounds
        .slice()
        .sort((a, b) => a.number - b.number)
        .map((round) => {
            if (round.number === latestRoundNumber || showPrevious) {
                return `<div class="round-visible">${renderRoundCard(round)}</div>`;
            } else {
                return `<div class="round-hidden" style="display:none;">${renderRoundCard(round)}</div>`;
            }
        })
        .join("");

    container.innerHTML = toggleBtn + cards;

    // Add event listener for toggle
    const btn = document.getElementById("toggle-rounds-btn");
    if (btn) {
        btn.onclick = function() {
            window._showPreviousRounds = !window._showPreviousRounds;
            renderRounds();
        };
    }
}

function renderRoundCard(round) {
    const matches = round.pairings
        .filter((pairing) => pairing.type === "match")
        .slice()
        .sort((a, b) => a.board - b.board);
    const byes = round.pairings.filter((pairing) => pairing.type === "bye");

    const matchRows = matches
        .map((pairing) => {
            const white = getPlayerById(pairing.whiteId);
            const black = getPlayerById(pairing.blackId);
            const select = createResultSelect(pairing, round.status === "completed");
            const storedResult = pairing.result ? describeResult(pairing.result) : "Not set";

            return `
                <tr>
                    <td>${pairing.board}</td>
                    <td>${white ? `${white.name} (${white.rating})` : "Unknown"}</td>
                    <td>${black ? `${black.name} (${black.rating})` : "Unknown"}</td>
                    <td>${round.status === "completed" ? storedResult : select}</td>
                </tr>
            `;
        })
        .join("");

    const byeRows = byes
        .map((pairing) => {
            const player = getPlayerById(pairing.playerId);
            if (!player) {
                return "";
            }
            const pointsText = formatScore(pairing.pointsAwarded);
            const reasonText = pairing.reason === "forced-bye" ? "Full-point bye (forced)" : `Opt-out bye (${pointsText} point)`;
            const statusText = round.status === "completed" ? `${pointsText} point awarded` : `${pointsText} point pending`;
            return `
                <tr>
                    <td>-</td>
                    <td colspan="2">${player.name}</td>
                    <td><span class="badge bye">${reasonText}</span> ${statusText}</td>
                </tr>
            `;
        })
        .join("");

    const actionButtons = round.status === "completed"
        ? ""
        : `<div class="round-actions"><button class="primary" data-action="save-round" data-round="${round.number}">Save Round ${round.number} Results</button></div>`;

    const statusText = round.status === "completed" ? "Results saved" : "Awaiting results";

    return `
        <article class="round-card">
            <header>
                <h3>Round ${round.number}</h3>
                <div class="round-meta">
                    <span>${state.settings.pairingMethod === "dutch" ? "Dutch" : "Monrad"} pairing</span>
                    <span class="round-status">${statusText}</span>
                </div>
            </header>
            <table class="round-table">
                <thead>
                    <tr>
                        <th>Board</th>
                        <th>White</th>
                        <th>Black</th>
                        <th>Result</th>
                    </tr>
                </thead>
                <tbody>
                    ${matchRows || "<tr><td colspan=\"4\">No matches scheduled.</td></tr>"}
                    ${byeRows}
                </tbody>
            </table>
            ${actionButtons}
        </article>
    `;
}

function createResultSelect(pairing, disabled) {
    const options = resultOptions
        .map((option) => {
            const attributes = [];
            if (pairing.result === option.value || (!pairing.result && option.value === "")) {
                attributes.push("selected");
            }
            return `<option value="${option.value}" ${attributes.join(" ")}>${option.label}</option>`;
        })
        .join("");

    return `<select data-result-for="${pairing.id}" ${disabled ? "disabled" : ""}>${options}</select>`;
}

function describeResult(value) {
    switch (value) {
        case "1-0":
            return "1 - 0";
        case "0-1":
            return "0 - 1";
        case "0.5-0.5":
            return "0.5 - 0.5";
        default:
            return value;
    }
}

function getMedianBuchholzOpponentScore(player) {
    if (!player) {
        return 0;
    }
    const forcedByeAdjustment = player.fullByeCount * 0.5;
    const optOutByeAdjustment = player.optOutByeCount * (state.settings.optOutBye - 0.5);
    const adjustedScore = player.score - forcedByeAdjustment - optOutByeAdjustment;
    return Math.max(0, adjustedScore);
}

// Builds Median Buchholz contributions for every player so standings share a consistent tie-break metric.
function calculateMedianBuchholzMap() {
    const contributions = new Map();
    state.players.forEach((player) => {
        contributions.set(player.id, []);
    });

    state.rounds.forEach((round) => {
        if (round.status !== "completed") {
            return;
        }
        round.pairings.forEach((pairing) => {
            if (pairing.type === "match") {
                const whitePlayer = getPlayerById(pairing.whiteId);
                const blackPlayer = getPlayerById(pairing.blackId);
                if (!whitePlayer || !blackPlayer) {
                    return;
                }
                contributions.get(whitePlayer.id).push(getMedianBuchholzOpponentScore(blackPlayer));
                contributions.get(blackPlayer.id).push(getMedianBuchholzOpponentScore(whitePlayer));
            } else if (pairing.type === "bye") {
                const byePlayer = getPlayerById(pairing.playerId);
                if (!byePlayer) {
                    return;
                }
                contributions.get(byePlayer.id).push(0);
            }
        });
    });

    const result = new Map();
    contributions.forEach((values, playerId) => {
        const roundsPlayed = values.length;
        if (roundsPlayed <= 2) {
            result.set(playerId, { value: null, display: "N/A" });
            return;
        }
        const sorted = values.slice().sort((a, b) => a - b);
        const trimmed = roundsPlayed >= 9 ? sorted.slice(2, sorted.length - 2) : sorted.slice(1, sorted.length - 1);
        const total = trimmed.reduce((sum, entry) => sum + entry, 0);
        result.set(playerId, { value: total, display: formatScore(total) });
    });

    return result;
}

function renderScoreboard() {
    const container = document.getElementById("scoreboard");
    if (!container) {
        return;
    }

    if (!state.players.length) {
        container.innerHTML = "<p>No players to display.</p>";
        return;
    }

    const medianBuchholz = calculateMedianBuchholzMap();

    const ranked = state.players
        .slice()
        .sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            const mbA = medianBuchholz.get(a.id)?.value;
            const mbB = medianBuchholz.get(b.id)?.value;
            const safeA = mbA === null || mbA === undefined ? -Infinity : mbA;
            const safeB = mbB === null || mbB === undefined ? -Infinity : mbB;
            if (safeB !== safeA) {
                return safeB - safeA;
            }
            if (b.rating !== a.rating) {
                return b.rating - a.rating;
            }
            return a.name.localeCompare(b.name);
        });

    const rows = ranked
        .map((player, index) => {
            const totalGames = player.matchesPlayed + player.fullByeCount + player.optOutByeCount;
            const byeSummaryParts = [];
            if (player.fullByeCount) {
                byeSummaryParts.push(`Full ${player.fullByeCount}`);
            }
            if (player.optOutByeCount) {
                byeSummaryParts.push(`Opt ${player.optOutByeCount}`);
            }
            const byeSummary = byeSummaryParts.join(", ") || "-";
            const colorSummary = `${player.colorHistory.white}/${player.colorHistory.black}`;
            const medianInfo = medianBuchholz.get(player.id);
            const medianDisplay = medianInfo ? medianInfo.display : "N/A";
            return `
                <tr>
                    <td>${index + 1}</td>
                    <td>${player.name}</td>
                    <td>${player.rating}</td>
                    <td>${formatScore(player.score)}</td>
                    <td>${medianDisplay}</td>
                    <td>${totalGames}</td>
                    <td>${colorSummary}</td>
                    <td>${byeSummary}</td>
                </tr>
            `;
        })
        .join("");

    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>#</th>
                    <th>Name</th>
                    <th>Rating</th>
                    <th>Score</th>
                    <th><span title="Median Buchholz: sum of opponents' adjusted scores excluding the highest and lowest (two each for 9+ rounds).">MB</span></th>
                    <th>Games</th>
                    <th>W/B</th>
                    <th>Byes</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
    `;
}

function formatScore(score) {
    const rounded = Math.round(score * 2) / 2;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function flashMessage(type, text, duration = 4000) {
    const area = document.getElementById("message-area");
    if (!area) {
        return;
    }
    area.textContent = text;
    area.className = `message-area show ${type}`;
    if (messageTimeout) {
        clearTimeout(messageTimeout);
    }
    messageTimeout = setTimeout(() => {
        area.className = "message-area";
        area.textContent = "";
    }, duration);
}
