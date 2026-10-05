const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

const MAP_SIZE = 3000;
const INITIAL_RADIUS = 22;
const PELLET_COUNT = 550;
const OBSTACLE_COUNT = 24;
const OBSTACLE_RADIUS = 46;
const MAX_CELLS_PER_PLAYER = 16;
const COLORS = [
    '#FF3366', '#33CCFF', '#33FF66', '#FFCC00',
    '#9933FF', '#FF6600', '#00FFCC', '#FF0099'
];

let players = {};
let pellets = [];
let ejectedPellets = [];
let obstacles = [];

function spawnPellet() {
    return {
        id: Math.random().toString(36).substring(2, 9),
        x: Math.floor(Math.random() * (MAP_SIZE - 60)) + 30,
        y: Math.floor(Math.random() * (MAP_SIZE - 60)) + 30,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        radius: 5
    };
}

function spawnObstacle() {
    return {
        id: 'obs_' + Math.random().toString(36).substring(2, 9),
        x: Math.floor(Math.random() * (MAP_SIZE - 300)) + 150,
        y: Math.floor(Math.random() * (MAP_SIZE - 300)) + 150,
        radius: OBSTACLE_RADIUS,
        hits: 0
    };
}

// Initial Spawn ng Energy Pellets at Obstacles (Viruses)
for (let i = 0; i < PELLET_COUNT; i++) {
    pellets.push(spawnPellet());
}
for (let i = 0; i < OBSTACLE_COUNT; i++) {
    obstacles.push(spawnObstacle());
}

function createInitialCell() {
    return {
        id: 'c_' + Math.random().toString(36).substring(2, 7),
        x: Math.floor(Math.random() * (MAP_SIZE - 400)) + 200,
        y: Math.floor(Math.random() * (MAP_SIZE - 400)) + 200,
        vx: 0,
        vy: 0,
        radius: INITIAL_RADIUS,
        canMergeAfter: 0
    };
}

wss.on('connection', (ws) => {
    const playerId = Math.random().toString(36).substring(2, 9);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];

    players[playerId] = {
        id: playerId,
        ws,
        name: 'Cell',
        avatar: '',
        authProvider: 'guest',
        color,
        targetX: 0,
        targetY: 0,
        cells: [createInitialCell()]
    };

    ws.send(JSON.stringify({ type: 'init', id: playerId, mapSize: MAP_SIZE }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const player = players[playerId];
            if (!player) return;

            if (data.type === 'join') {
                player.name = (data.name && data.name.trim()) ? data.name.trim().substring(0, 16) : 'Cell';
                player.avatar = data.avatar || '';
                player.authProvider = data.authProvider || 'guest';
                if (!player.cells || player.cells.length === 0) {
                    player.cells = [createInitialCell()];
                }
            }
            else if (data.type === 'move') {
                player.targetX = Number(data.x) || 0;
                player.targetY = Number(data.y) || 0;
            }
            else if (data.type === 'eject') {
                // Hotkey 'R': Eject small food pellet
                if (!player.cells || player.cells.length === 0) return;

                // Hanapin ang pinakamalaking cell o lahat ng cells na radius >= 26
                player.cells.forEach(cell => {
                    if (cell.radius >= 26) {
                        const angle = Math.atan2(player.targetY, player.targetX);

                        // Bawasan bahagya ang laki ng cell
                        cell.radius = Math.max(22, Math.sqrt(cell.radius * cell.radius - 12));

                        // Spawn ejected food pellet sa harap ng cell patungo sa mouse
                        const spawnDist = cell.radius + 12;
                        const px = cell.x + Math.cos(angle) * spawnDist;
                        const py = cell.y + Math.sin(angle) * spawnDist;

                        ejectedPellets.push({
                            id: 'ej_' + Math.random().toString(36).substring(2, 9),
                            x: Math.max(10, Math.min(MAP_SIZE - 10, px)),
                            y: Math.max(10, Math.min(MAP_SIZE - 10, py)),
                            vx: Math.cos(angle) * 22,
                            vy: Math.sin(angle) * 22,
                            radius: 7,
                            color: player.color,
                            shooterId: player.id
                        });
                    }
                });
            }
            else if (data.type === 'split') {
                // Hotkey Spacebar: Maghati ang bilog (Split into two)
                if (!player.cells || player.cells.length >= MAX_CELLS_PER_PLAYER) return;

                const currentCells = [...player.cells];
                const angle = Math.atan2(player.targetY, player.targetX);

                currentCells.forEach(cell => {
                    if (cell.radius >= 30 && player.cells.length < MAX_CELLS_PER_PLAYER) {
                        // Hatiin sa dalawa (pantay na mass)
                        const splitRadius = cell.radius / Math.SQRT2;
                        cell.radius = splitRadius;
                        cell.canMergeAfter = Date.now() + 14000; // 14 seconds cooldown bago mag-merge

                        // Gumawa ng bagong half cell na mag-sho-shoot forward
                        const forwardDist = splitRadius + 15;
                        const newCell = {
                            id: 'c_' + Math.random().toString(36).substring(2, 7),
                            x: Math.max(splitRadius, Math.min(MAP_SIZE - splitRadius, cell.x + Math.cos(angle) * forwardDist)),
                            y: Math.max(splitRadius, Math.min(MAP_SIZE - splitRadius, cell.y + Math.sin(angle) * forwardDist)),
                            vx: Math.cos(angle) * 26,
                            vy: Math.sin(angle) * 26,
                            radius: splitRadius,
                            canMergeAfter: Date.now() + 14000
                        };

                        player.cells.push(newCell);
                    }
                });
            }
            else if (data.type === 'respawn') {
                player.cells = [createInitialCell()];
            }
        } catch (err) {
            console.error('Error handling WS message:', err);
        }
    });

    ws.on('close', () => {
        delete players[playerId];
    });
});

// Server Game Loop (30 Ticks Per Second)
setInterval(() => {
    // 1. Update Ejected Pellets (Physics and Friction)
    for (let i = ejectedPellets.length - 1; i >= 0; i--) {
        const ep = ejectedPellets[i];
        ep.x += ep.vx;
        ep.y += ep.vy;
        ep.vx *= 0.88;
        ep.vy *= 0.88;

        // Map boundary check
        ep.x = Math.max(ep.radius, Math.min(MAP_SIZE - ep.radius, ep.x));
        ep.y = Math.max(ep.radius, Math.min(MAP_SIZE - ep.radius, ep.y));

        // Interaction sa Obstacles: kung tumama ang ejected food sa obstacle
        let consumedByObstacle = false;
        for (let obs of obstacles) {
            const odx = ep.x - obs.x;
            const ody = ep.y - obs.y;
            if (Math.sqrt(odx * odx + ody * ody) < obs.radius + ep.radius) {
                obs.hits = (obs.hits || 0) + 1;
                consumedByObstacle = true;
                if (obs.hits >= 7 && obstacles.length < 32) {
                    obs.hits = 0;
                    // Mag-clone ng panibagong obstacle
                    obstacles.push(spawnObstacle());
                }
                break;
            }
        }

        if (consumedByObstacle) {
            ejectedPellets.splice(i, 1);
        }
    }

    // 2. Physics at Movement ng Bawat Player Cell
    Object.values(players).forEach(player => {
        if (!player.cells || player.cells.length === 0) return;

        const pMouseX = player.targetX;
        const pMouseY = player.targetY;
        const dist = Math.sqrt(pMouseX * pMouseX + pMouseY * pMouseY);

        player.cells.forEach(cell => {
            // Movement speed nakadepende sa laki ng cell (mas malaki = mas mabagal)
            const baseSpeed = Math.max(1.8, 7.5 - (cell.radius * 0.022));

            if (dist > 5) {
                cell.x += (pMouseX / dist) * baseSpeed + (cell.vx || 0);
                cell.y += (pMouseY / dist) * baseSpeed + (cell.vy || 0);
            } else {
                cell.x += (cell.vx || 0);
                cell.y += (cell.vy || 0);
            }

            // Decay impulse velocities
            cell.vx = (cell.vx || 0) * 0.90;
            cell.vy = (cell.vy || 0) * 0.90;

            // Map Borders
            cell.x = Math.max(cell.radius, Math.min(MAP_SIZE - cell.radius, cell.x));
            cell.y = Math.max(cell.radius, Math.min(MAP_SIZE - cell.radius, cell.y));

            // Kainin ang Energy Pellets
            pellets.forEach((pellet, pIndex) => {
                const pdx = cell.x - pellet.x;
                const pdy = cell.y - pellet.y;
                const pDist = Math.sqrt(pdx * pdx + pdy * pdy);

                if (pDist < cell.radius) {
                    cell.radius += 0.22;
                    pellets[pIndex] = spawnPellet();
                }
            });

            // Kainin ang Ejected Pellets (R food)
            for (let eIdx = ejectedPellets.length - 1; eIdx >= 0; eIdx--) {
                const ep = ejectedPellets[eIdx];
                const edx = cell.x - ep.x;
                const edy = cell.y - ep.y;
                const eDist = Math.sqrt(edx * edx + edy * edy);

                if (eDist < cell.radius) {
                    cell.radius = Math.sqrt(cell.radius * cell.radius + 15);
                    ejectedPellets.splice(eIdx, 1);
                }
            }
        });

        // 3. Soft Collision at Re-merging ng Sariling Cells ng Player
        const now = Date.now();
        for (let i = 0; i < player.cells.length; i++) {
            for (let j = i + 1; j < player.cells.length; j++) {
                const c1 = player.cells[i];
                const c2 = player.cells[j];
                if (!c1 || !c2) continue;

                const cdx = c2.x - c1.x;
                const cdy = c2.y - c1.y;
                const cDist = Math.sqrt(cdx * cdx + cdy * cdy);
                const minDist = c1.radius + c2.radius;

                if (cDist < minDist) {
                    // Puwede na bang mag-merge? (Tapos na ang 14s timer)
                    if (now >= c1.canMergeAfter && now >= c2.canMergeAfter) {
                        // Pag-isahin ang dalawang bilog
                        c1.radius = Math.sqrt(c1.radius * c1.radius + c2.radius * c2.radius);
                        player.cells.splice(j, 1);
                        j--;
                    } else {
                        // Push apart bahagya para hindi magpatong nang buo habang bawal pa mag-merge
                        const overlap = (minDist - cDist) * 0.15;
                        const nx = (cdx / (cDist || 1)) * overlap;
                        const ny = (cdy / (cDist || 1)) * overlap;
                        c1.x -= nx;
                        c1.y -= ny;
                        c2.x += nx;
                        c2.y += ny;
                    }
                }
            }
        }

        // 4. Obstacle (Virus) Interaction:
        // "pag kasing laki mo yung obstackle bubutok ka at lalaki ka onti"
        for (let obsIndex = obstacles.length - 1; obsIndex >= 0; obsIndex--) {
            const obs = obstacles[obsIndex];
            if (!obs) continue;

            for (let cIdx = 0; cIdx < player.cells.length; cIdx++) {
                const cell = player.cells[cIdx];
                if (!cell) continue;

                const odx = cell.x - obs.x;
                const ody = cell.y - obs.y;
                const oDist = Math.sqrt(odx * odx + ody * ody);

                // Check collision sa obstacle
                if (oDist < cell.radius + obs.radius) {
                    // Kung kasing laki o mas malaki sa obstacle (radius >= obstacle radius * 0.95)
                    if (cell.radius >= obs.radius * 0.95) {
                        // BUBUTOK ANG CELL! At lalaki ka onti (+25 mass bonus)
                        const boostedRadius = Math.sqrt(cell.radius * cell.radius + 65);
                        
                        // Bilang ng shards na paghahatian ng mass (4 hanggang 6 na piraso)
                        const shardsCount = Math.min(6, MAX_CELLS_PER_PLAYER - player.cells.length + 1);
                        if (shardsCount > 1) {
                            const shardRadius = boostedRadius / Math.sqrt(shardsCount);
                            cell.radius = shardRadius;
                            cell.canMergeAfter = Date.now() + 16000;

                            for (let s = 1; s < shardsCount; s++) {
                                const angle = (Math.PI * 2 / shardsCount) * s;
                                player.cells.push({
                                    id: 'c_' + Math.random().toString(36).substring(2, 7),
                                    x: Math.max(shardRadius, Math.min(MAP_SIZE - shardRadius, cell.x + Math.cos(angle) * (obs.radius + 15))),
                                    y: Math.max(shardRadius, Math.min(MAP_SIZE - shardRadius, cell.y + Math.sin(angle) * (obs.radius + 15))),
                                    vx: Math.cos(angle) * 22,
                                    vy: Math.sin(angle) * 22,
                                    radius: shardRadius,
                                    canMergeAfter: Date.now() + 16000
                                });
                            }
                        } else {
                            cell.radius = boostedRadius;
                        }

                        // Respawn ang obstacle sa ibang lugar
                        obstacles[obsIndex] = spawnObstacle();

                        if (player.ws.readyState === WebSocket.OPEN) {
                            player.ws.send(JSON.stringify({ type: 'burst', bonus: true }));
                        }
                        break;
                    }
                }
            }
        }
    });

    // 5. Cellular Devour (Player eats Player Cells)
    const allPlayers = Object.values(players);
    for (let i = 0; i < allPlayers.length; i++) {
        const p1 = allPlayers[i];
        if (!p1.cells || p1.cells.length === 0) continue;

        for (let j = 0; j < allPlayers.length; j++) {
            if (i === j) continue;
            const p2 = allPlayers[j];
            if (!p2.cells || p2.cells.length === 0) continue;

            for (let c1 of p1.cells) {
                for (let k = p2.cells.length - 1; k >= 0; k--) {
                    const c2 = p2.cells[k];
                    // Kailangan mas malaki ng 12% para makakain
                    if (c1.radius > c2.radius * 1.12) {
                        const dx = c1.x - c2.x;
                        const dy = c1.y - c2.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);

                        if (dist < c1.radius - (c2.radius / 3)) {
                            // Lumalaki si p1 cell
                            c1.radius = Math.sqrt(c1.radius * c1.radius + c2.radius * c2.radius * 0.7);
                            p2.cells.splice(k, 1);

                            // Kung naubos lahat ng cell ni p2
                            if (p2.cells.length === 0) {
                                if (p2.ws.readyState === WebSocket.OPEN) {
                                    p2.ws.send(JSON.stringify({ type: 'eaten' }));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 6. Broadcast Game State sa Lahat ng Clients
    const gameState = {
        players: Object.values(players).map(p => ({
            id: p.id,
            name: p.name,
            avatar: p.avatar,
            authProvider: p.authProvider,
            color: p.color,
            totalMass: Math.floor((p.cells || []).reduce((sum, c) => sum + (c.radius * c.radius) / 20, 0)),
            cells: (p.cells || []).map(c => ({
                x: Math.round(c.x),
                y: Math.round(c.y),
                radius: Math.round(c.radius * 10) / 10
            }))
        })),
        pellets,
        ejectedPellets,
        obstacles
    };

    const payload = JSON.stringify({ type: 'update', state: gameState });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}, 1000 / 30);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Cellular Devour Server running on http://localhost:${PORT}`);
});
