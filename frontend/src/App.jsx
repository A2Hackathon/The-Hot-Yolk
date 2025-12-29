import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Mic, MicOff, Loader, AlertCircle } from 'lucide-react';

// API Configuration
const API_BASE = 'http://localhost:8000/api';

// Game State Management
const GameState = {
  IDLE: 'idle',
  LISTENING: 'listening',
  GENERATING: 'generating',
  PLAYING: 'playing',
  MODIFYING: 'modifying'
};

const VoiceWorldBuilder = () => {
  const containerRef = useRef(null);
  const [gameState, setGameState] = useState(GameState.IDLE);
  const [error, setError] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [enemyCount, setEnemyCount] = useState(0);
  const [playerHealth, setPlayerHealth] = useState(100);
  
  // Three.js refs
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const playerRef = useRef(null);
  const enemiesRef = useRef([]);
  const worldDataRef = useRef(null);
  const animationIdRef = useRef(null);
  const terrainRef = useRef(null);
  const heightmapDataRef = useRef(null);
  
  // Player state
  const playerStateRef = useRef({
    velocity: new THREE.Vector3(),
    position: new THREE.Vector3(),
    rotation: 0,
    isGrounded: false,
    canDoubleJump: false,
    hasDoubleJumped: false,
    isDashing: false,
    dashTime: 0,
    dashCooldown: 0,
    health: 100
  });
  
  // Input state
  const keysRef = useRef({});
  const mouseRef = useRef({ x: 0, y: 0 });

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x87CEEB, 50, 200);
    sceneRef.current = scene;

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 10, 20);
    cameraRef.current = camera;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
    scene.add(directionalLight);

    // Handle window resize
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // Input handlers
    const handleKeyDown = (e) => {
      keysRef.current[e.code] = true;
      
      // Space for jump
      if (e.code === 'Space' && playerRef.current) {
        e.preventDefault();
        handleJump();
      }
      
      // Shift for dash
      if (e.code === 'ShiftLeft' && playerRef.current) {
        handleDash();
      }
    };

    const handleKeyUp = (e) => {
      keysRef.current[e.code] = false;
    };

    const handleMouseMove = (e) => {
      mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
      
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
      
      renderer.dispose();
    };
  }, []);

  // Get terrain height at position
  const getTerrainHeight = (x, z) => {
    if (!heightmapDataRef.current) return 0;
    
    const heightmap = heightmapDataRef.current;
    const tx = Math.floor(x + 64);
    const tz = Math.floor(z + 64);
    
    if (tx < 0 || tx >= 128 || tz < 0 || tz >= 128) return 0;
    
    return heightmap[tz][tx] || 0;
  };

  // Jump handler
  const handleJump = () => {
    const state = playerStateRef.current;
    const config = worldDataRef.current?.physics;
    
    if (!config) return;
    
    const jumpHeight = config.player.jump_height;
    const mechanic = config.mechanic.type;
    
    if (state.isGrounded) {
      state.velocity.y = jumpHeight;
      state.isGrounded = false;
      state.hasDoubleJumped = false;
    } else if (mechanic === 'double_jump' && !state.hasDoubleJumped) {
      state.velocity.y = jumpHeight;
      state.hasDoubleJumped = true;
    }
  };

  // Dash handler
  const handleDash = () => {
    const state = playerStateRef.current;
    const config = worldDataRef.current?.physics;
    
    if (!config || config.mechanic.type !== 'dash') return;
    if (state.isDashing || state.dashCooldown > 0) return;
    
    state.isDashing = true;
    state.dashTime = config.mechanic.dash_duration;
    state.dashCooldown = config.mechanic.dash_cooldown;
  };

  // Create terrain mesh from heightmap
  const createTerrain = async (heightmapUrl, textureUrl) => {
    return new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      
      const fullHeightmapUrl = API_BASE.replace('/api', '') + heightmapUrl;
      const fullTextureUrl = API_BASE.replace('/api', '') + textureUrl;
      
      Promise.all([
        new Promise((res) => loader.load(fullHeightmapUrl, res)),
        new Promise((res) => loader.load(fullTextureUrl, res))
      ]).then(([heightmap, texture]) => {
        const geometry = new THREE.PlaneGeometry(128, 128, 127, 127);
        geometry.rotateX(-Math.PI / 2);
        
        // Apply heightmap to vertices
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 128;
        canvas.height = 128;
        
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, 128, 128);
          
          const vertices = geometry.attributes.position.array;
          for (let i = 0; i < vertices.length; i += 3) {
            const x = Math.floor((vertices[i] + 64));
            const z = Math.floor((vertices[i + 2] + 64));
            const idx = (z * 128 + x) * 4;
            const height = (imageData.data[idx] / 255) * 10;
            vertices[i + 1] = height;
          }
          
          geometry.computeVertexNormals();
          geometry.attributes.position.needsUpdate = true;
          
          const material = new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 0.8,
            metalness: 0.2
          });
          
          const mesh = new THREE.Mesh(geometry, material);
          mesh.receiveShadow = true;
          resolve(mesh);
        };
        img.onerror = reject;
        img.src = fullHeightmapUrl;
      }).catch(reject);
    });
  };

  // Create player
  const createPlayer = (spawnPoint) => {
    const geometry = new THREE.CylinderGeometry(0.5, 0.5, 2, 16);
    const material = new THREE.MeshStandardMaterial({ color: 0x4444ff });
    const player = new THREE.Mesh(geometry, material);
    
    player.position.set(
      spawnPoint.x - 64,
      spawnPoint.y,
      spawnPoint.z - 64
    );
    player.castShadow = true;
    
    playerStateRef.current.position.copy(player.position);
    return player;
  };

  // Create enemy
  const createEnemy = (enemyData) => {
    const geometry = new THREE.BoxGeometry(1, 2, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0xff4444 });
    const enemy = new THREE.Mesh(geometry, material);
    
    enemy.position.set(
      enemyData.position.x - 64,
      enemyData.position.y,
      enemyData.position.z - 64
    );
    enemy.castShadow = true;
    
    // Store enemy data
    enemy.userData = {
      ...enemyData,
      state: 'patrol',
      patrolTarget: null,
      chaseTarget: null
    };
    
    return enemy;
  };

  // Update lighting
  const updateLighting = (lightingConfig) => {
    const scene = sceneRef.current;
    if (!scene) return;
    
    // Update ambient light
    const ambientLight = scene.children.find(c => c.isAmbientLight);
    if (ambientLight) {
      ambientLight.color.setStyle(lightingConfig.ambient.color);
      ambientLight.intensity = lightingConfig.ambient.intensity;
    }
    
    // Update directional light
    const directionalLight = scene.children.find(c => c.isDirectionalLight);
    if (directionalLight) {
      directionalLight.color.setStyle(lightingConfig.directional.color);
      directionalLight.intensity = lightingConfig.directional.intensity;
      directionalLight.position.set(
        lightingConfig.directional.position.x,
        lightingConfig.directional.position.y,
        lightingConfig.directional.position.z
      );
    }
    
    // Update fog
    scene.fog.color.setStyle(lightingConfig.fog.color);
    scene.fog.near = lightingConfig.fog.near;
    scene.fog.far = lightingConfig.fog.far;
    
    // Update background
    scene.background = new THREE.Color(lightingConfig.background);
  };

  // Game loop
  const animate = () => {
    animationIdRef.current = requestAnimationFrame(animate);
    
    const delta = 0.016; // ~60fps
    const player = playerRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const state = playerStateRef.current;
    const config = worldDataRef.current?.physics;
    
    if (!player || !config) return;
    
    // Update dash cooldown
    if (state.dashCooldown > 0) {
      state.dashCooldown -= delta;
    }
    
    // Handle dash
    if (state.isDashing) {
      state.dashTime -= delta;
      if (state.dashTime <= 0) {
        state.isDashing = false;
      }
    }
    
    // Movement input
    const moveSpeed = state.isDashing ? config.mechanic.dash_speed : config.player.speed;
    const forward = new THREE.Vector3(0, 0, -1);
    const right = new THREE.Vector3(1, 0, 0);
    
    let moveDirection = new THREE.Vector3();
    
    if (keysRef.current['KeyW']) moveDirection.add(forward);
    if (keysRef.current['KeyS']) moveDirection.sub(forward);
    if (keysRef.current['KeyA']) moveDirection.sub(right);
    if (keysRef.current['KeyD']) moveDirection.add(right);
    
    if (moveDirection.length() > 0) {
      moveDirection.normalize();
      state.velocity.x = moveDirection.x * moveSpeed;
      state.velocity.z = moveDirection.z * moveSpeed;
    } else {
      state.velocity.x *= 0.9;
      state.velocity.z *= 0.9;
    }
    
    // Apply gravity
    if (!state.isGrounded) {
      state.velocity.y += config.player.gravity * delta;
    }
    
    // Update position
    state.position.add(state.velocity.clone().multiplyScalar(delta));
    
    // Terrain collision
    const terrainHeight = getTerrainHeight(state.position.x, state.position.z);
    const groundLevel = terrainHeight + 1;
    
    if (state.position.y <= groundLevel) {
      state.position.y = groundLevel;
      state.velocity.y = 0;
      state.isGrounded = true;
    } else {
      state.isGrounded = false;
    }
    
    // Update player mesh
    player.position.copy(state.position);
    
    // Update camera to follow player
    camera.position.set(
      state.position.x,
      state.position.y + 5,
      state.position.z + 15
    );
    camera.lookAt(state.position);
    
    // Update enemies
    enemiesRef.current.forEach(enemy => {
      const enemyData = enemy.userData;
      const distanceToPlayer = enemy.position.distanceTo(player.position);
      
      // Simple AI state machine
      if (distanceToPlayer < enemyData.detection_radius) {
        enemyData.state = 'chase';
        
        // Move toward player
        const direction = new THREE.Vector3()
          .subVectors(player.position, enemy.position)
          .normalize();
        
        enemy.position.add(direction.multiplyScalar(enemyData.speed * delta));
        
        // Attack if close
        if (distanceToPlayer < enemyData.attack_radius) {
          // Damage player (simplified)
          if (Math.random() < 0.02) {
            state.health -= enemyData.damage;
            setPlayerHealth(Math.max(0, state.health));
          }
        }
      } else {
        enemyData.state = 'patrol';
        // Simple patrol (random walk)
        if (Math.random() < 0.01) {
          enemyData.patrolTarget = new THREE.Vector3(
            enemy.position.x + (Math.random() - 0.5) * 10,
            enemy.position.y,
            enemy.position.z + (Math.random() - 0.5) * 10
          );
        }
      }
    });
    
    // Render
    rendererRef.current.render(scene, camera);
  };

  // Generate world from voice
  const generateWorld = async () => {
    try {
      setGameState(GameState.GENERATING);
      setError(null);
      
      const response = await fetch(`${API_BASE}/generate-world`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) throw new Error('Failed to generate world');
      
      const data = await response.json();
      worldDataRef.current = data;
      heightmapDataRef.current = data.world.heightmap_raw || [];
      
      // Clear existing scene (keep lights)
      const scene = sceneRef.current;
      const objectsToRemove = [];
      scene.children.forEach(child => {
        if (!child.isLight) {
          objectsToRemove.push(child);
        }
      });
      objectsToRemove.forEach(obj => scene.remove(obj));
      
      // Create terrain
      const terrain = await createTerrain(
        data.world.heightmap_url,
        data.world.texture_url
      );
      scene.add(terrain);
      terrainRef.current = terrain;
      
      // Update lighting
      updateLighting(data.world.lighting_config);
      
      // Create player
      const player = createPlayer(data.spawn_point);
      scene.add(player);
      playerRef.current = player;
      playerStateRef.current.health = 100;
      setPlayerHealth(100);
      
      // Create enemies
      enemiesRef.current = [];
      data.combat.enemies.forEach(enemyData => {
        const enemy = createEnemy(enemyData);
        scene.add(enemy);
        enemiesRef.current.push(enemy);
      });
      
      setEnemyCount(data.combat.enemies.length);
      setGameState(GameState.PLAYING);
      
      // Start game loop
      animate();
      
    } catch (err) {
      console.error('Generation error:', err);
      setError(err.message);
      setGameState(GameState.IDLE);
    }
  };

  // Voice capture using Web Speech API
  const startVoiceCapture = () => {
    if (!('webkitSpeechRecognition' in window)) {
      setError('Speech recognition not supported in this browser');
      return;
    }
    
    const recognition = new webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    
    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
    };
    
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      console.log('Voice command:', transcript);
      setIsListening(false);
      
      if (gameState === GameState.IDLE) {
        generateWorld();
      }
    };
    
    recognition.onerror = (event) => {
      setError(`Speech recognition error: ${event.error}`);
      setIsListening(false);
    };
    
    recognition.onend = () => {
      setIsListening(false);
    };
    
    try {
      recognition.start();
    } catch (err) {
      setError('Microphone access denied or unavailable');
      setIsListening(false);
    }
  };

  return (
    <div className="relative w-full h-screen bg-black">
      {/* 3D Canvas Container */}
      <div ref={containerRef} className="w-full h-full" />
      
      {/* UI Overlay */}
      <div className="absolute top-0 left-0 right-0 p-4 pointer-events-none">
        {/* Top Bar */}
        <div className="flex justify-between items-start">
          {/* Title */}
          <div className="bg-black/50 backdrop-blur-sm rounded-lg px-4 py-2">
            <h1 className="text-white text-xl font-bold">Prompt-to-Playable</h1>
            <p className="text-white/70 text-sm">Voice-Driven World Builder</p>
          </div>
          
          {/* Stats */}
          {gameState === GameState.PLAYING && (
            <div className="bg-black/50 backdrop-blur-sm rounded-lg px-4 py-2">
              <div className="text-white text-sm space-y-1">
                <div>Health: {Math.round(playerHealth)}%</div>
                <div>Enemies: {enemyCount}</div>
              </div>
            </div>
          )}
        </div>
        
        {/* Error Message */}
        {error && (
          <div className="mt-4 bg-red-500/90 backdrop-blur-sm rounded-lg px-4 py-3 flex items-center gap-2">
            <AlertCircle className="text-white" size={20} />
            <p className="text-white text-sm">{error}</p>
          </div>
        )}
      </div>
      
      {/* Center UI */}
      {gameState === GameState.IDLE && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="bg-black/70 backdrop-blur-sm rounded-2xl px-8 py-12 text-center max-w-md pointer-events-auto">
            <h2 className="text-white text-3xl font-bold mb-4">
              Speak to Create
            </h2>
            <p className="text-white/80 mb-8">
              Try: "Make an icy city at sunset with 6 enemies and dash attacks"
            </p>
            <button
              onClick={startVoiceCapture}
              disabled={isListening}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white px-8 py-4 rounded-full font-semibold transition-colors flex items-center gap-3 mx-auto"
            >
              {isListening ? (
                <>
                  <Loader className="animate-spin" size={24} />
                  Listening...
                </>
              ) : (
                <>
                  <Mic size={24} />
                  Start Speaking
                </>
              )}
            </button>
          </div>
        </div>
      )}
      
      {gameState === GameState.GENERATING && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="bg-black/70 backdrop-blur-sm rounded-2xl px-8 py-12 text-center">
            <Loader className="animate-spin text-white mx-auto mb-4" size={48} />
            <h2 className="text-white text-2xl font-bold">Generating World...</h2>
          </div>
        </div>
      )}
      
      {/* Floating Mic Button (during gameplay) */}
      {gameState === GameState.PLAYING && (
        <button
          onClick={startVoiceCapture}
          disabled={isListening}
          className="absolute top-4 right-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white p-4 rounded-full shadow-lg transition-colors pointer-events-auto z-50"
          title="Voice command"
        >
          {isListening ? (
            <MicOff size={24} className="animate-pulse" />
          ) : (
            <Mic size={24} />
          )}
        </button>
      )}
      
      {/* Controls Help */}
      {gameState === GameState.PLAYING && (
        <div className="absolute bottom-4 left-4 bg-black/50 backdrop-blur-sm rounded-lg px-4 py-3 pointer-events-none">
          <div className="text-white text-sm space-y-1">
            <div className="font-bold mb-2">Controls:</div>
            <div>WASD - Move</div>
            <div>Space - Jump</div>
            <div>Shift - Dash</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VoiceWorldBuilder; 
