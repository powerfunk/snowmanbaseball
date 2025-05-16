const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Serve static files from the public directory
app.use(express.static('public'));

// Game state
const gameState = {
    players: new Map(),
    currentPitcher: null,
    currentBatter: null,
    inning: 1,
    outs: 0,
    score: 0,
    gameStatus: 'waiting', // waiting, pitching, batting, fielding
    pitchType: null, // fastball, curve, changeup
    pitchSpeed: 0,
    pitchAccuracy: 0,
    isCPUPlaying: false
};

// Field dimensions
const FIELD_DIMENSIONS = {
    size: 100,
    diamondSize: 70,
    pitcherMoundRadius: 5
};

// Pitch types and their properties
const PITCH_TYPES = {
    fastball: { speed: 1.0, accuracy: 0.8 },
    curve: { speed: 0.7, accuracy: 0.6 },
    changeup: { speed: 0.5, accuracy: 0.9 }
};

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    // Handle player joining
    socket.on('join', (data) => {
        const player = {
            id: socket.id,
            name: data.name,
            position: { x: 0, y: 0, z: 0 },
            isPitching: false,
            isBatting: false,
            stats: {
                hits: 0,
                homeRuns: 0,
                runs: 0,
                strikes: 0,
                balls: 0
            }
        };

        gameState.players.set(socket.id, player);

        // First player becomes batter, second becomes pitcher
        if (gameState.players.size === 1) {
            player.isBatting = true;
            gameState.currentBatter = socket.id;
            gameState.isCPUPlaying = true;
            startCPUPitcher();
            gameState.gameStatus = 'waiting';
        } else if (gameState.players.size === 2) {
            player.isPitching = true;
            gameState.currentPitcher = socket.id;
            gameState.isCPUPlaying = false;
            gameState.gameStatus = 'pitching';
            // Start the game with the human pitcher
            socket.emit('gameStateUpdate', {
                inning: gameState.inning,
                outs: gameState.outs,
                score: gameState.score,
                currentPitcher: gameState.currentPitcher,
                currentBatter: gameState.currentBatter,
                gameStatus: gameState.gameStatus
            });
        }

        // Broadcast player joined event
        io.emit('playerJoined', {
            id: player.id,
            name: player.name,
            isPitching: player.isPitching,
            isBatting: player.isBatting
        });

        // Send current game state to the new player
        socket.emit('gameStateUpdate', {
            inning: gameState.inning,
            outs: gameState.outs,
            score: gameState.score,
            currentPitcher: gameState.currentPitcher,
            currentBatter: gameState.currentBatter,
            gameStatus: gameState.gameStatus
        });
    });

    // Handle chat messages
    socket.on('chat', (message) => {
        const player = gameState.players.get(socket.id);
        if (player) {
            io.emit('chat', {
                name: player.name,
                message: message
            });
        }
    });

    // Handle pitch selection
    socket.on('selectPitch', (data) => {
        if (gameState.currentPitcher === socket.id) {
            gameState.pitchType = data.type;
            gameState.gameStatus = 'pitching';
            
            // Generate flash sequence for pitcher
            const flashSequence = generateFlashSequence();
            socket.emit('startPitching', {
                pitchType: data.type,
                flashSequence: flashSequence
            });
        }
    });

    // Handle pitch timing
    socket.on('pitchTiming', (data) => {
        if (gameState.currentPitcher === socket.id) {
            const accuracy = calculatePitchAccuracy(data.timings, data.flashSequence);
            const speed = calculatePitchSpeed(data.timings);
            
            gameState.pitchSpeed = speed;
            gameState.pitchAccuracy = accuracy;
            gameState.gameStatus = 'batting';

            // Start batting sequence
            io.emit('startBatting', {
                pitchType: gameState.pitchType,
                pitchSpeed: speed,
                flashSequence: generateFlashSequence(speed)
            });
        }
    });

    // Handle swing timing
    socket.on('swingTiming', (data) => {
        if (gameState.currentBatter === socket.id) {
            const accuracy = calculateSwingAccuracy(data.timings, data.flashSequence);
            const power = calculateSwingPower(data.timings);
            
            // Calculate hit result
            const hitResult = calculateHitResult(accuracy, power, gameState.pitchSpeed, gameState.pitchAccuracy);
            
            // Update game state based on hit result
            updateGameState(hitResult);

            // Broadcast hit result
            io.emit('hitResult', {
                type: hitResult.type,
                power: hitResult.power,
                accuracy: hitResult.accuracy
            });
        }
    });

    // Handle player movement
    socket.on('move', (data) => {
        const player = gameState.players.get(socket.id);
        if (player) {
            // Update position based on direction
            const moveSpeed = 0.5;
            switch (data.direction) {
                case 'up':
                    player.position.z -= moveSpeed;
                    break;
                case 'down':
                    player.position.z += moveSpeed;
                    break;
                case 'left':
                    player.position.x -= moveSpeed;
                    break;
                case 'right':
                    player.position.x += moveSpeed;
                    break;
            }
            
            // Keep player within field bounds
            player.position.x = Math.max(-FIELD_DIMENSIONS.size/2, Math.min(FIELD_DIMENSIONS.size/2, player.position.x));
            player.position.z = Math.max(-FIELD_DIMENSIONS.size/2, Math.min(FIELD_DIMENSIONS.size/2, player.position.z));
            
            io.emit('playerMoved', {
                id: socket.id,
                position: player.position
            });
        }
    });

    // Handle player disconnection
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        gameState.players.delete(socket.id);

        // If pitcher disconnects, make CPU the pitcher
        if (gameState.currentPitcher === socket.id) {
            gameState.isCPUPlaying = true;
            startCPUPitcher();
        }

        // If batter disconnects, make CPU the batter
        if (gameState.currentBatter === socket.id) {
            gameState.isCPUPlaying = true;
            startCPUBatter();
        }

        // Broadcast player left event
        io.emit('playerLeft', socket.id);

        // Broadcast game state update
        io.emit('gameStateUpdate', {
            inning: gameState.inning,
            outs: gameState.outs,
            score: gameState.score,
            currentPitcher: gameState.currentPitcher,
            currentBatter: gameState.currentBatter,
            gameStatus: gameState.gameStatus
        });
    });
});

// Helper functions
function generateFlashSequence(pitchSpeed = 1) {
    const sequence = [];
    const numFlashes = 2;
    const baseInterval = 1000; // Base interval in milliseconds
    
    for (let i = 0; i < numFlashes; i++) {
        sequence.push({
            time: i * (baseInterval / pitchSpeed),
            position: {
                x: Math.random() * 0.8 + 0.1,
                y: Math.random() * 0.8 + 0.1
            }
        });
    }
    
    return sequence;
}

function calculatePitchAccuracy(timings, flashSequence) {
    let totalError = 0;
    for (let i = 0; i < timings.length; i++) {
        const error = Math.abs(timings[i] - flashSequence[i].time);
        totalError += error;
    }
    return Math.max(0, 1 - (totalError / 1000));
}

function calculatePitchSpeed(timings) {
    if (timings.length < 2) return 0;
    const interval = timings[1] - timings[0];
    return Math.max(0.5, Math.min(1.5, 1000 / interval));
}

function calculateSwingAccuracy(timings, flashSequence) {
    return calculatePitchAccuracy(timings, flashSequence);
}

function calculateSwingPower(timings) {
    return calculatePitchSpeed(timings);
}

function calculateHitResult(swingAccuracy, swingPower, pitchSpeed, pitchAccuracy) {
    const hitChance = (swingAccuracy + pitchAccuracy) / 2;
    const power = (swingPower + pitchSpeed) / 2;
    
    if (hitChance < 0.3) {
        return { type: 'strike', power: 0, accuracy: hitChance };
    } else if (hitChance < 0.6) {
        return { type: 'foul', power: power * 0.5, accuracy: hitChance };
    } else if (hitChance < 0.8) {
        return { type: 'hit', power: power, accuracy: hitChance };
    } else {
        return { type: 'homeRun', power: power * 1.5, accuracy: hitChance };
    }
}

function updateGameState(hitResult) {
    const batter = gameState.players.get(gameState.currentBatter);
    
    switch (hitResult.type) {
        case 'strike':
            batter.stats.strikes++;
            if (batter.stats.strikes >= 3) {
                gameState.outs++;
                batter.stats.strikes = 0;
                batter.stats.balls = 0;
            }
            break;
        case 'hit':
            batter.stats.hits++;
            break;
        case 'homeRun':
            batter.stats.homeRuns++;
            batter.stats.runs++;
            gameState.score++;
            break;
    }

    if (gameState.outs >= 3) {
        gameState.inning++;
        gameState.outs = 0;
        // Swap roles
        [gameState.currentPitcher, gameState.currentBatter] = [gameState.currentBatter, gameState.currentPitcher];
        gameState.players.get(gameState.currentPitcher).isPitching = true;
        gameState.players.get(gameState.currentPitcher).isBatting = false;
        gameState.players.get(gameState.currentBatter).isPitching = false;
        gameState.players.get(gameState.currentBatter).isBatting = true;
    }
}

function startCPUPitcher() {
    // CPU pitcher logic
    setInterval(() => {
        if (gameState.isCPUPlaying && gameState.currentPitcher === 'cpu') {
            const pitchType = Object.keys(PITCH_TYPES)[Math.floor(Math.random() * 3)];
            const flashSequence = generateFlashSequence();
            
            // Simulate CPU timing
            setTimeout(() => {
                const timings = flashSequence.map(flash => flash.time + Math.random() * 200 - 100);
                const accuracy = calculatePitchAccuracy(timings, flashSequence);
                const speed = calculatePitchSpeed(timings);
                
                gameState.pitchSpeed = speed;
                gameState.pitchAccuracy = accuracy;
                gameState.gameStatus = 'batting';
                
                io.emit('startBatting', {
                    pitchType: pitchType,
                    pitchSpeed: speed,
                    flashSequence: generateFlashSequence(speed)
                });
            }, 2000);
        }
    }, 5000);
}

function startCPUBatter() {
    // CPU batter logic
    setInterval(() => {
        if (gameState.isCPUPlaying && gameState.currentBatter === 'cpu') {
            const flashSequence = generateFlashSequence(gameState.pitchSpeed);
            
            // Simulate CPU timing
            setTimeout(() => {
                const timings = flashSequence.map(flash => flash.time + Math.random() * 200 - 100);
                const accuracy = calculateSwingAccuracy(timings, flashSequence);
                const power = calculateSwingPower(timings);
                
                const hitResult = calculateHitResult(accuracy, power, gameState.pitchSpeed, gameState.pitchAccuracy);
                updateGameState(hitResult);
                
                io.emit('hitResult', {
                    type: hitResult.type,
                    power: hitResult.power,
                    accuracy: hitResult.accuracy
                });
            }, 2000);
        }
    }, 5000);
}

// Start server
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 