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
const PELLET_COUNT = 500;
const COLORS = [
    '#FF3366', '#33CCFF', '#33FF66', '#FFCC00',
    '#9933FF', '#FF6600', '#00FFCC', '#FF0099'
];

let players = {};
let pellets = [];

function spawnPellet() {
    return {
        id: Math.random().toString(36).substring(2, 9),
        x: Math.floor(Math.random() * (MAP_SIZE - 60)) + 30,
        y: Math.floor(Math.random() * (MAP_SIZE - 60)) + 30,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        radius: 5
    };
}

// Initial Spawn ng Energy Pellets
for (let i = 0; i < PELLET_COUNT; i++) {
    pellets.push(spawnPellet());
}

wss.on('connection', (ws) => {
    const playerId = Math.random().toString(36).substring(2, 9);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];

    players[playerId] = {
        id: playerId,
        ws,
        name: 'Cell',
        x: Math.floor(Math.random() * (MAP_SIZE - 300)) + 150,
        y: Math.floor(Math.random() * (MAP_SIZE - 300)) + 150,
        radius: INITIAL_RADIUS,
        color,
        targetX: 0,
        targetY: 0
    };

    ws.send(JSON.stringify({ type: 'init', id: playerId, mapSize: MAP_SIZE }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'join') {
                if (players[playerId]) {
                    players[playerId].name = data.name || 'Cell';
                }
            }
            else if (data.type === 'move') {
                if (players[playerId]) {
                    players[playerId].targetX = data.x;
                    players[playerId].targetY = data.y;
                }
            }
            else if (data.type === 'split') {
                const p = players[playerId];
                // Dynamic Requirement: Radius >= 32 para makapag-dash / split
                if (p && p.radius >= 32) {
                    const angle = Math.atan2(p.targetY, p.targetX);

                    // Bawasan ang size/mass ng main cell
                    p.radius = p.radius / 1.35;

                    // Forward Dash Impulse patungo sa mouse target
                    const dashDistance = Math.min(p.radius * 4, 180);
                    p.x += Math.cos(angle) * dashDistance;
                    p.y += Math.sin(angle) * dashDistance;

                    // Siguraduhing hindi lalabas sa map border
                    p.x = Math.max(p.radius, Math.min(MAP_SIZE - p.radius, p.x));
                    p.y = Math.max(p.radius, Math.min(MAP_SIZE - p.radius, p.y));
                }
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
    Object.values(players).forEach(player => {
        const dx = player.targetX;
        const dy = player.targetY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Physics Movement
        if (dist > 5) {
            const speed = Math.max(1.8, 7.5 - (player.radius * 0.022));
            player.x += (dx / dist) * speed;
            player.y += (dy / dist) * speed;

            player.x = Math.max(player.radius, Math.min(MAP_SIZE - player.radius, player.x));
            player.y = Math.max(player.radius, Math.min(MAP_SIZE - player.radius, player.y));
        }

        // Kainin ang Energy Pellets
        pellets.forEach((pellet, index) => {
            const pdx = player.x - pellet.x;
            const pdy = player.y - pellet.y;
            const pDist = Math.sqrt(pdx * pdx + pdy * pdy);

            if (pDist < player.radius) {
                player.radius += 0.25;
                pellets[index] = spawnPellet();
            }
        });

        // Cellular Devour Mechanic (Kainin ang ibang mas maliliit na Players)
        Object.values(players).forEach(otherPlayer => {
            if (player.id !== otherPlayer.id && player.radius > otherPlayer.radius * 1.12) {
                const odx = player.x - otherPlayer.x;
                const ody = player.y - otherPlayer.y;
                const oDist = Math.sqrt(odx * odx + ody * ody);

                if (oDist < player.radius - (otherPlayer.radius / 3)) {
                    // Dagdag mass sa kumain
                    player.radius += otherPlayer.radius * 0.35;

                    // Respawn sa nakain na cell
                    otherPlayer.radius = INITIAL_RADIUS;
                    otherPlayer.x = Math.floor(Math.random() * (MAP_SIZE - 300)) + 150;
                    otherPlayer.y = Math.floor(Math.random() * (MAP_SIZE - 300)) + 150;

                    if (otherPlayer.ws.readyState === WebSocket.OPEN) {
                        otherPlayer.ws.send(JSON.stringify({ type: 'eaten' }));
                    }
                }
            }
        });
    });

    // Broadcast game state sa lahat ng players
    const gameState = {
        players: Object.values(players).map(p => ({
            id: p.id,
            name: p.name,
            x: p.x,
            y: p.y,
            radius: p.radius,
            color: p.color
        })),
        pellets
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
