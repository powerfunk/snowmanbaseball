// Debug logging setup
console.log('SCRIPT STARTING');
window.onerror = function(msg, url, lineNo, columnNo, error) {
    console.error('Error: ' + msg + '\nURL: ' + url + '\nLine: ' + lineNo + '\nColumn: ' + columnNo + '\nError object: ' + JSON.stringify(error));
    return false;
};

console.log('START OF GAME.JS');
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import './lib/nipplejs.min.js';

// Constants
const FIELD_SIZE = 100;
const PITCHER_MOUND_DISTANCE = 60;
const BAT_SIZE = 2;
const BALL_SIZE = 0.5;
const PLAYER_SIZE = 1;
const PITCH_SPEEDS = {
    SLOW: 30,
    MEDIUM: 45,
    FAST: 60
};

// Baseball field dimensions
const FIELD_DIMENSIONS = {
    INFIELD_RADIUS: 30,
    OUTFIELD_RADIUS: 90,
    PITCHER_MOUND_HEIGHT: 0.5,
    BASE_DISTANCE: 27.4, // 90 feet in meters
    WALL_HEIGHT: 10
};

// Player colors (ROYGBIV + Brown, White, Black)
const PLAYER_COLORS = [
    0xFF0000, // Red
    0xFF7F00, // Orange
    0xFFFF00, // Yellow
    0x00FF00, // Green
    0x0000FF, // Blue
    0x4B0082, // Indigo
    0x9400D3, // Violet
    0x8B4513, // Brown
    0xFFFFFF, // White
    0x000000  // Black
];

class Game {
    constructor() {
        console.log('Game constructor started');
        
        // Initialize core components
        this.scene = new THREE.Scene();
        
        // Mobile detection
        const userAgent = navigator.userAgent.toLowerCase();
        const isMobileDevice = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
        const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        const isSmallScreen = window.innerWidth <= 768;
        
        this.isMobile = isMobileDevice && (hasTouchScreen || isSmallScreen);
        
        // Camera setup
        const fov = this.isMobile ? 90 : 75;
        this.camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.1, 1000);
        
        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: document.getElementById('gameCanvas'),
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        
        // Game state
        this.players = new Map();
        this.pitcher = null;
        this.balls = new Map();
        this.currentBatter = null;
        this.gameState = 'waiting'; // waiting, pitching, batting, fielding
        
        // Stats
        this.stats = {
            hits: 0,
            homeRuns: 0,
            battingAvg: 0,
            runs: 0,
            strikes: 0,
            balls: 0
        };
        
        // Controls
        this.keys = {
            'ArrowUp': false,
            'ArrowDown': false,
            'ArrowLeft': false,
            'ArrowRight': false,
            ' ': false // Space for swing
        };
        
        // Timing
        this.lastUpdateTime = Date.now();
        this.accumulatedTime = 0;
        this.timeStep = 1000 / 60;
        
        // Setup
        this.setupScene();
        this.setupControls();
        this.setupEventListeners();
        this.setupSocket();
        
        // Start game loop
        this.animate();
        window.game = this;
    }
    
    setupScene() {
        // Set background color to sky blue
        this.scene.background = new THREE.Color(0x87CEEB);
        
        // Create baseball field
        this.createBaseballField();
        
        // Create pitcher
        this.pitcher = new Pitcher(this.scene, this);
        
        // Set initial camera position
        this.updateCameraView();
    }
    
    createBaseballField() {
        // Create infield (dirt)
        const infieldGeometry = new THREE.CircleGeometry(FIELD_DIMENSIONS.INFIELD_RADIUS, 32);
        const infieldMaterial = new THREE.MeshBasicMaterial({ color: 0x8B4513 });
        const infield = new THREE.Mesh(infieldGeometry, infieldMaterial);
        infield.rotation.x = -Math.PI / 2;
        this.scene.add(infield);
        
        // Create outfield (grass)
        const outfieldGeometry = new THREE.RingGeometry(
            FIELD_DIMENSIONS.INFIELD_RADIUS,
            FIELD_DIMENSIONS.OUTFIELD_RADIUS,
            32
        );
        const outfieldMaterial = new THREE.MeshBasicMaterial({ color: 0x228B22 });
        const outfield = new THREE.Mesh(outfieldGeometry, outfieldMaterial);
        outfield.rotation.x = -Math.PI / 2;
        this.scene.add(outfield);
        
        // Create pitcher's mound
        const moundGeometry = new THREE.CylinderGeometry(3, 3, FIELD_DIMENSIONS.PITCHER_MOUND_HEIGHT, 32);
        const moundMaterial = new THREE.MeshBasicMaterial({ color: 0x8B4513 });
        const mound = new THREE.Mesh(moundGeometry, moundMaterial);
        mound.position.set(0, FIELD_DIMENSIONS.PITCHER_MOUND_HEIGHT/2, PITCHER_MOUND_DISTANCE);
        this.scene.add(mound);
        
        // Create bases
        const baseGeometry = new THREE.BoxGeometry(1, 0.1, 1);
        const baseMaterial = new THREE.MeshBasicMaterial({ color: 0xFFFFFF });
        
        // Home plate
        const homePlate = new THREE.Mesh(baseGeometry, baseMaterial);
        homePlate.position.set(0, 0.05, 0);
        this.scene.add(homePlate);
        
        // First base
        const firstBase = new THREE.Mesh(baseGeometry, baseMaterial);
        firstBase.position.set(FIELD_DIMENSIONS.BASE_DISTANCE, 0.05, 0);
        this.scene.add(firstBase);
        
        // Second base
        const secondBase = new THREE.Mesh(baseGeometry, baseMaterial);
        secondBase.position.set(0, 0.05, FIELD_DIMENSIONS.BASE_DISTANCE);
        this.scene.add(secondBase);
        
        // Third base
        const thirdBase = new THREE.Mesh(baseGeometry, baseMaterial);
        thirdBase.position.set(-FIELD_DIMENSIONS.BASE_DISTANCE, 0.05, 0);
        this.scene.add(thirdBase);
        
        // Create outfield wall
        const wallGeometry = new THREE.BoxGeometry(FIELD_DIMENSIONS.OUTFIELD_RADIUS * 2, FIELD_DIMENSIONS.WALL_HEIGHT, 0.5);
        const wallMaterial = new THREE.MeshBasicMaterial({ color: 0x8B4513 });
        
        // Left field wall
        const leftWall = new THREE.Mesh(wallGeometry, wallMaterial);
        leftWall.position.set(-FIELD_DIMENSIONS.OUTFIELD_RADIUS, FIELD_DIMENSIONS.WALL_HEIGHT/2, 0);
        leftWall.rotation.y = Math.PI / 2;
        this.scene.add(leftWall);
        
        // Right field wall
        const rightWall = new THREE.Mesh(wallGeometry, wallMaterial);
        rightWall.position.set(FIELD_DIMENSIONS.OUTFIELD_RADIUS, FIELD_DIMENSIONS.WALL_HEIGHT/2, 0);
        rightWall.rotation.y = Math.PI / 2;
        this.scene.add(rightWall);
        
        // Center field wall
        const centerWall = new THREE.Mesh(wallGeometry, wallMaterial);
        centerWall.position.set(0, FIELD_DIMENSIONS.WALL_HEIGHT/2, -FIELD_DIMENSIONS.OUTFIELD_RADIUS);
        this.scene.add(centerWall);
    }
    
    // ... existing code for setupControls, setupEventListeners, setupSocket ...
    
    updateCameraView() {
        switch(this.currentView) {
            case 'top':
                this.camera.position.set(0, 50, 0);
                this.camera.lookAt(0, 0, 0);
                break;
            case 'isometric':
                this.camera.position.set(30, 30, 30);
                this.camera.lookAt(0, 0, 0);
                break;
            case 'first-person':
                if (this.currentBatter) {
                    const pos = this.currentBatter.getPosition();
                    this.camera.position.set(pos.x, 2, pos.z);
                    this.camera.lookAt(0, 2, PITCHER_MOUND_DISTANCE);
                }
                break;
        }
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        const currentTime = Date.now();
        const deltaTime = currentTime - this.lastUpdateTime;
        this.lastUpdateTime = currentTime;
        
        this.accumulatedTime += deltaTime;
        
        while (this.accumulatedTime >= this.timeStep) {
            this.update(this.timeStep);
            this.accumulatedTime -= this.timeStep;
        }
        
        this.renderer.render(this.scene, this.camera);
    }
    
    update(deltaTime) {
        // Update pitcher
        if (this.pitcher) {
            this.pitcher.update(deltaTime);
        }
        
        // Update balls
        for (const ball of this.balls.values()) {
            ball.update(deltaTime);
        }
        
        // Update current batter
        if (this.currentBatter) {
            this.currentBatter.update(deltaTime);
        }
        
        // Update stats display
        this.updateStats();
    }
    
    updateStats() {
        document.getElementById('hits').textContent = this.stats.hits;
        document.getElementById('homeRuns').textContent = this.stats.homeRuns;
        document.getElementById('battingAvg').textContent = this.stats.battingAvg.toFixed(3);
        document.getElementById('runs').textContent = this.stats.runs;
        document.getElementById('strikes').textContent = this.stats.strikes;
        document.getElementById('balls').textContent = this.stats.balls;
    }
}

class Player {
    constructor(scene, id, socket, color, playerName) {
        this.scene = scene;
        this.id = id;
        this.socket = socket;
        this.color = color;
        this.playerName = playerName;
        
        // Create player mesh
        const geometry = new THREE.BoxGeometry(PLAYER_SIZE, PLAYER_SIZE * 2, PLAYER_SIZE);
        const material = new THREE.MeshBasicMaterial({ color: this.color });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.set(0, PLAYER_SIZE, 0);
        this.scene.add(this.mesh);
        
        // Create bat
        const batGeometry = new THREE.CylinderGeometry(0.1, 0.2, BAT_SIZE, 8);
        const batMaterial = new THREE.MeshBasicMaterial({ color: 0x8B4513 });
        this.bat = new THREE.Mesh(batGeometry, batMaterial);
        this.bat.position.set(0, 0, 0);
        this.mesh.add(this.bat);
        
        // Player state
        this.position = new THREE.Vector3(0, 0, 0);
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.isSwinging = false;
        this.swingProgress = 0;
    }
    
    update(deltaTime) {
        // Update position based on velocity
        this.position.add(this.velocity.clone().multiplyScalar(deltaTime / 1000));
        
        // Update mesh position
        this.mesh.position.copy(this.position);
        
        // Update bat swing animation
        if (this.isSwinging) {
            this.swingProgress += deltaTime / 500; // 500ms swing duration
            if (this.swingProgress >= 1) {
                this.isSwinging = false;
                this.swingProgress = 0;
                this.bat.rotation.x = 0;
            } else {
                this.bat.rotation.x = Math.PI * 2 * this.swingProgress;
            }
        }
    }
    
    swing() {
        if (!this.isSwinging) {
            this.isSwinging = true;
            this.swingProgress = 0;
        }
    }
    
    getPosition() {
        return this.position;
    }
}

class Pitcher {
    constructor(scene, game) {
        this.scene = scene;
        this.game = game;
        
        // Create pitcher mesh
        const geometry = new THREE.BoxGeometry(PLAYER_SIZE, PLAYER_SIZE * 2, PLAYER_SIZE);
        const material = new THREE.MeshBasicMaterial({ color: 0xFFFFFF });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.set(0, PLAYER_SIZE, PITCHER_MOUND_DISTANCE);
        this.scene.add(this.mesh);
        
        // Pitching state
        this.pitchTimer = 0;
        this.pitchInterval = 3000; // Pitch every 3 seconds
    }
    
    update(deltaTime) {
        this.pitchTimer += deltaTime;
        if (this.pitchTimer >= this.pitchInterval) {
            this.pitchTimer = 0;
            this.pitch();
        }
    }
    
    pitch() {
        const ball = new Ball(this.scene, this.mesh.position.clone());
        this.game.balls.set(ball.id, ball);
        
        // Calculate pitch trajectory
        const target = new THREE.Vector3(0, 1, 0); // Home plate
        const direction = target.clone().sub(this.mesh.position).normalize();
        const speed = PITCH_SPEEDS.MEDIUM;
        
        ball.velocity.copy(direction.multiplyScalar(speed));
    }
}

class Ball {
    constructor(scene, position) {
        this.scene = scene;
        this.id = Date.now();
        
        // Create ball mesh
        const geometry = new THREE.SphereGeometry(BALL_SIZE, 16, 16);
        const material = new THREE.MeshBasicMaterial({ color: 0xFFFFFF });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(position);
        this.scene.add(this.mesh);
        
        // Ball state
        this.position = position.clone();
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.isHit = false;
    }
    
    update(deltaTime) {
        // Update position based on velocity
        this.position.add(this.velocity.clone().multiplyScalar(deltaTime / 1000));
        
        // Apply gravity
        this.velocity.y -= 9.8 * (deltaTime / 1000);
        
        // Update mesh position
        this.mesh.position.copy(this.position);
        
        // Check for collisions with field
        this.checkCollisions();
    }
    
    checkCollisions() {
        // Check for ground collision
        if (this.position.y <= BALL_SIZE) {
            this.position.y = BALL_SIZE;
            this.velocity.y = -this.velocity.y * 0.6; // Bounce with energy loss
        }
        
        // Check for wall collisions
        if (Math.abs(this.position.x) >= FIELD_DIMENSIONS.OUTFIELD_RADIUS) {
            this.position.x = Math.sign(this.position.x) * FIELD_DIMENSIONS.OUTFIELD_RADIUS;
            this.velocity.x = -this.velocity.x * 0.8;
        }
        
        if (this.position.z <= -FIELD_DIMENSIONS.OUTFIELD_RADIUS) {
            this.position.z = -FIELD_DIMENSIONS.OUTFIELD_RADIUS;
            this.velocity.z = -this.velocity.z * 0.8;
        }
    }
    
    hit(hitPower, hitDirection) {
        this.isHit = true;
        this.velocity.copy(hitDirection.multiplyScalar(hitPower));
    }
}

// Initialize game when window loads
window.addEventListener('load', () => {
    new Game();
}); 