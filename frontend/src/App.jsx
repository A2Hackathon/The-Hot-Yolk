import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

const API_BASE = 'http://localhost:8000/api';

const GameState = {
  IDLE: 'idle',
  LISTENING: 'listening',
  GENERATING: 'generating',
  PLAYING: 'playing',
};

const VoiceWorldBuilder = () => {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const animationIdRef = useRef(null);

  const heightmapRef = useRef(null);
  const colorMapRef = useRef(null);
  const terrainMeshRef = useRef(null); // new ref for the actual terrain mesh
  const playerRef = useRef(null);
  const enemiesRef = useRef([]);

  const [gameState, setGameState] = useState(GameState.IDLE);
  const [isListening, setIsListening] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [submittedPrompt, setSubmittedPrompt] = useState('');

  // Player state
  const playerState = useRef({
    velocity: new THREE.Vector3(),
    isGrounded: false,
    canDoubleJump: true,
    isDashing: false,
    dashTime: 0,
    dashCooldown: 0,
  });

  // Camera orbit offsets
  const cameraOffset = useRef({ distance: 15, height: 8, angle: 0 });
  const pressedKeys = useRef(new Set());

  // --- Setup Three.js ---
  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x1a1f3a, 10, 500);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 10, 20);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // Key handlers
    const handleKeyDown = (e) => {
      pressedKeys.current.add(e.key);

      // Jump
      if (e.key === ' ' && playerRef.current) {
        if (playerState.current.isGrounded) {
          playerState.current.velocity.y = 0.35;
          playerState.current.isGrounded = false;
        } else if (playerState.current.canDoubleJump) {
          playerState.current.velocity.y = 0.35;
          playerState.current.canDoubleJump = false;
        }
      }

      // Dash
      if ((e.key === 'Shift' || e.key === 'ShiftLeft') && playerRef.current) {
        if (playerState.current.dashCooldown <= 0) {
          playerState.current.isDashing = true;
          playerState.current.dashTime = 0.2;
          playerState.current.dashCooldown = 1.0;
        }
      }
    };
    const handleKeyUp = (e) => pressedKeys.current.delete(e.key);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Animate loop
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);

      const player = playerRef.current;
      const cam = cameraRef.current;
      const terrainMesh = terrainMeshRef.current; // check mesh exists
      if (player && cam && terrainMesh) {
        const moveSpeed = 0.25;
        const dashSpeed = 1.0;
        const gravity = -0.015;

        // --- Camera rotation with arrow keys ---
        if (pressedKeys.current.has('ArrowLeft')) cameraOffset.current.angle += 0.03;
        if (pressedKeys.current.has('ArrowRight')) cameraOffset.current.angle -= 0.03;

        // --- WASD movement relative to camera ---
        let moveVector = new THREE.Vector3();
        if (pressedKeys.current.has('w')) moveVector.z -= 1;
        if (pressedKeys.current.has('s')) moveVector.z += 1;
        if (pressedKeys.current.has('a')) moveVector.x -= 1;
        if (pressedKeys.current.has('d')) moveVector.x += 1;

        if (moveVector.length() > 0) {
          moveVector.normalize();

          const camDir = new THREE.Vector3();
          cam.getWorldDirection(camDir);
          camDir.y = 0;
          camDir.normalize();

          const camRight = new THREE.Vector3();
          camRight.crossVectors(new THREE.Vector3(0, 1, 0), camDir).normalize();

          const dx = camDir.x * moveVector.z + camRight.x * moveVector.x;
          const dz = camDir.z * moveVector.z + camRight.z * moveVector.x;

          let speed = moveSpeed;
          if (playerState.current.isDashing) speed = dashSpeed;

          player.position.x += dx * speed;
          player.position.z += dz * speed;
        }

        // --- Dash timer ---
        if (playerState.current.isDashing) {
          playerState.current.dashTime -= 0.016;
          if (playerState.current.dashTime <= 0) playerState.current.isDashing = false;
        } else if (playerState.current.dashCooldown > 0) {
          playerState.current.dashCooldown -= 0.016;
        }

        // --- Gravity & jumping ---
        playerState.current.velocity.y += gravity;
        let newY = player.position.y + playerState.current.velocity.y;

        // Terrain collision using heightmap array
        const terrainY = getHeightAt(player.position.x, player.position.z) + 2;
        if (newY < terrainY) {
          newY = terrainY;
          playerState.current.velocity.y = 0;
          playerState.current.isGrounded = true;
          playerState.current.canDoubleJump = true;
        } else {
          playerState.current.isGrounded = false;
        }

        player.position.y = newY;

        // --- Camera follows player ---
        const { distance, height, angle } = cameraOffset.current;
        const targetX = player.position.x - Math.sin(angle) * distance;
        const targetZ = player.position.z - Math.cos(angle) * distance;
        const targetY = player.position.y + height;

        cam.position.lerp(new THREE.Vector3(targetX, targetY, targetZ), 0.1);
        cam.lookAt(player.position);

        // Rotate enemies
        enemiesRef.current.forEach((enemy) => (enemy.rotation.y += 0.005));
      }

      rendererRef.current.render(sceneRef.current, cameraRef.current);
    };
    animate();

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      cancelAnimationFrame(animationIdRef.current);
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  // --- Terrain ---
  const createTerrain = (heightmap, colorMapArray, size = 128) => {
    const segments = heightmap.length - 1;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position.array;
    const colors = [];

    for (let i = 0; i < positions.length; i += 3) {
      const idx = i / 3;
      const row = Math.floor(idx / (segments + 1));
      const col = idx % (segments + 1);
      positions[i + 1] = heightmap[row][col] * 10;
      const [r, g, b] = colorMapArray[row][col];
      colors.push(r / 255, g / 255, b / 255);
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    return mesh;
  };

  const createPlayer = (spawn) => {
    const geometry = new THREE.CylinderGeometry(1, 1, 4, 16);
    const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const player = new THREE.Mesh(geometry, material);
    const y = getHeightAt(spawn.x, spawn.z) + 2;
    player.position.set(spawn.x, y, spawn.z);
    player.castShadow = true;
    return player;
  };

  const getHeightAt = (x, z, size = 128) => {
    if (!heightmapRef.current) return 0;
    const map = heightmapRef.current;
    const segments = map.length - 1;
    const halfSize = size / 2;
    const nx = (x + halfSize) / size;
    const nz = (z + halfSize) / size;
    const ix = Math.max(0, Math.min(Math.floor(nx * segments), segments));
    const iz = Math.max(0, Math.min(Math.floor(nz * segments), segments));
    return map[iz][ix] * 10;
  };

  const createEnemies = (list) => {
    return list.map((e) => {
      const geometry = new THREE.BoxGeometry(2, 4, 2);
      const material = new THREE.MeshStandardMaterial({ color: 0x990000 });
      const enemy = new THREE.Mesh(geometry, material);
      enemy.position.set(e.position.x, getHeightAt(e.position.x, e.position.z) + 2, e.position.z);
      enemy.castShadow = true;
      return enemy;
    });
  };

  // --- Generate world ---
  const generateWorld = async (promptText) => {
    setGameState(GameState.GENERATING);
    try {
      const res = await fetch(`${API_BASE}/generate-world`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText }),
      });
      const data = await res.json();
      const scene = sceneRef.current;
      if (!scene) return;

      // Remove old meshes
      scene.children.filter((c) => !c.isLight).forEach((c) => scene.remove(c));
      terrainMeshRef.current = null;

      if (data.world.heightmap_raw && data.world.colour_map_array) {
        heightmapRef.current = data.world.heightmap_raw;
        colorMapRef.current = data.world.colour_map_array;
        const terrainMesh = createTerrain(heightmapRef.current, colorMapRef.current, 128);
        terrainMeshRef.current = terrainMesh;
        scene.add(terrainMesh);
      }

      const playerMesh = createPlayer(data.spawn_point);
      playerRef.current = playerMesh;
      scene.add(playerMesh);

      enemiesRef.current = createEnemies(data.combat.enemies || []);
      enemiesRef.current.forEach((e) => scene.add(e));

      setGameState(GameState.PLAYING);
    } catch (err) {
      console.error(err);
      setGameState(GameState.IDLE);
    }
  };

  // --- Voice Capture ---
  const startVoiceCapture = () => {
    if (!('webkitSpeechRecognition' in window)) return alert('Speech recognition not supported');
    setIsListening(true);
    const recognition = new webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setIsListening(false);
      setSubmittedPrompt(transcript);
      generateWorld(transcript);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute' }} />

      {gameState === GameState.IDLE && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 100,
                      display: 'flex', justifyContent: 'center', alignItems: 'center',
                      backgroundColor: 'rgba(0,0,0,0.85)', flexDirection: 'column', fontFamily: "'Audiowide',sans-serif",
                      textAlign: 'center'}}>
          <h1 style={{ fontSize: '3rem', fontWeight: 'bold', background: 'linear-gradient(90deg,#ff0000,#ff5555,#990000)',
                       WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: '24px'}}>
            Voice World Builder
          </h1>
          <button onClick={startVoiceCapture}>{isListening ? 'Listening...' : '🎤 Speak'}</button>
          <input type="text" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Type your prompt..." />
          <button onClick={() => { setSubmittedPrompt(prompt); generateWorld(prompt); setPrompt(''); }}>Submit</button>
          {submittedPrompt && <p>Last prompt: "{submittedPrompt}"</p>}
        </div>
      )}
      {gameState === GameState.GENERATING && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 100,
                      display: 'flex', justifyContent: 'center', alignItems: 'center',
                      backgroundColor: 'rgba(0,0,0,0.85)', flexDirection: 'column'}}>
          <h2>Generating World...</h2>
        </div>
      )}
    </div>
  );
};

export default VoiceWorldBuilder;
