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
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const animationIdRef = useRef(null);

  const terrainRef = useRef(null);
  const heightmapRef = useRef(null);
  const colorMapRef = useRef(null);
  const playerRef = useRef(null);
  const enemiesRef = useRef([]);

  const [gameState, setGameState] = useState(GameState.IDLE);
  const [isListening, setIsListening] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [submittedPrompt, setSubmittedPrompt] = useState('');

  // Player dimensions
  const playerHeight = 4; // Cylinder height
  const playerRadius = 1;

  // Camera offset for RPG style
  const cameraOffset = useRef({ distance: 15, height: 8, angle: 0 });

  // Track pressed keys for smooth movement
  const pressedKeys = useRef(new Set());

  // Player vertical movement for jump
  const playerVelocity = useRef({ y: 0 });
  const gravity = -0.015; // Gravity acceleration
  const jumpForce = 0.3; // Jump upward velocity

  // --- Three.js Setup ---
  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x000000, 10, 500);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // --- Key tracking ---
    const handleKeyDown = (e) => {
      pressedKeys.current.add(e.key);
      // Jump
      if (e.key === ' ' && playerRef.current) {
        const terrainY = getHeightAt(playerRef.current.position.x, playerRef.current.position.z) + playerHeight / 2;
        if (playerRef.current.position.y <= terrainY + 0.01) {
          playerVelocity.current.y = jumpForce;
        }
      }
    };
    const handleKeyUp = (e) => pressedKeys.current.delete(e.key);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // --- Animate loop ---
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);

      const player = playerRef.current;
      const cam = cameraRef.current;

      if (player && cam) {
        const moveSpeed = 0.3;
        const rotSpeed = 0.03;
        const angle = player.rotation.y;

        // Player rotation Q/E
        if (pressedKeys.current.has('q')) player.rotation.y += rotSpeed;
        if (pressedKeys.current.has('e')) player.rotation.y -= rotSpeed;

        // --- Fixed WASD movement for Three.js ---
        let moveX = 0, moveZ = 0;
        if (pressedKeys.current.has('w')) { moveX += Math.sin(angle) * moveSpeed; moveZ -= Math.cos(angle) * moveSpeed; }
        if (pressedKeys.current.has('s')) { moveX -= Math.sin(angle) * moveSpeed; moveZ += Math.cos(angle) * moveSpeed; }
        if (pressedKeys.current.has('a')) { moveX -= Math.cos(angle) * moveSpeed; moveZ -= Math.sin(angle) * moveSpeed; }
        if (pressedKeys.current.has('d')) { moveX += Math.cos(angle) * moveSpeed; moveZ += Math.sin(angle) * moveSpeed; }

        const newX = player.position.x + moveX;
        const newZ = player.position.z + moveZ;

        // --- Jump & gravity ---
        playerVelocity.current.y += gravity;
        let newY = player.position.y + playerVelocity.current.y;

        // Terrain collision
        const terrainY = getHeightAt(newX, newZ) + playerHeight / 2;
        if (newY < terrainY) {
          newY = terrainY;
          playerVelocity.current.y = 0;
        }

        player.position.set(newX, newY, newZ);

        // Camera rotation with arrow keys
        if (pressedKeys.current.has('ArrowLeft')) cameraOffset.current.angle += 0.03;
        if (pressedKeys.current.has('ArrowRight')) cameraOffset.current.angle -= 0.03;

        // Camera follows player
        const { distance, height, angle: camAngle } = cameraOffset.current;
        const targetX = player.position.x - Math.sin(player.rotation.y + camAngle) * distance;
        const targetZ = player.position.z - Math.cos(player.rotation.y + camAngle) * distance;
        const targetY = player.position.y + height;
        const targetPos = new THREE.Vector3(targetX, targetY, targetZ);
        cam.position.lerp(targetPos, 0.05);
        cam.lookAt(player.position);
      }

      // Rotate enemies
      enemiesRef.current.forEach((enemy) => (enemy.rotation.y += 0.005));

      renderer.render(sceneRef.current, cameraRef.current);
    };
    animate();

    // Resize handler
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
      const vertexIndex = i / 3;
      const row = Math.floor(vertexIndex / (segments + 1));
      const col = vertexIndex % (segments + 1);

      const zIdx = Math.min(row, heightmap.length - 1);
      const xIdx = Math.min(col, heightmap[0].length - 1);

      positions[i + 1] = heightmap[zIdx][xIdx] * 10;

      const [r, g, b] = colorMapArray[zIdx][xIdx];
      colors.push(r / 255, g / 255, b / 255);
    }

    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    return mesh;
  };

  // --- Player ---
  const createPlayer = (spawn) => {
    const geometry = new THREE.CylinderGeometry(playerRadius, playerRadius, playerHeight, 16);
    const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const player = new THREE.Mesh(geometry, material);
    // Spawn on top of terrain
    const y = getHeightAt(spawn.x, spawn.z) + playerHeight / 2;
    player.position.set(spawn.x, y, spawn.z);
    player.castShadow = true;
    return player;
  };

  const getHeightAt = (x, z, size = 128) => {
    if (!heightmapRef.current) return 0;
    const heightmap = heightmapRef.current;
    const segments = heightmap.length - 1;
    const halfSize = size / 2;

    const nx = (x + halfSize) / size;
    const nz = (z + halfSize) / size;

    const ix = Math.floor(nx * segments);
    const iz = Math.floor(nz * segments);

    const cx = Math.max(0, Math.min(ix, segments));
    const cz = Math.max(0, Math.min(iz, segments));

    return heightmap[cz][cx] * 10;
  };

  // --- Enemies ---
  const createEnemies = (enemyDataList) => {
    return enemyDataList.map((enemyData) => {
      const geometry = new THREE.BoxGeometry(2, 4, 2);
      const material = new THREE.MeshStandardMaterial({ color: 0x990000 });
      const enemy = new THREE.Mesh(geometry, material);

      const yPos = getHeightAt(enemyData.position.x, enemyData.position.z) + 2; // half enemy height
      enemy.position.set(enemyData.position.x, yPos, enemyData.position.z);
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

      scene.children.filter((child) => !child.isLight).forEach((child) => scene.remove(child));

      if (data.world.heightmap_raw && data.world.colour_map_array) {
        heightmapRef.current = data.world.heightmap_raw;
        colorMapRef.current = data.world.colour_map_array;
        const terrainMesh = createTerrain(data.world.heightmap_raw, data.world.colour_map_array, 128);
        scene.add(terrainMesh);
        terrainRef.current = terrainMesh;
      }

      const spawn = data.spawn_point;
      const playerMesh = createPlayer({ x: spawn.x, z: spawn.z });
      scene.add(playerMesh);
      playerRef.current = playerMesh;

      enemiesRef.current = createEnemies(data.combat.enemies || []);
      enemiesRef.current.forEach((enemy) => scene.add(enemy));

      setGameState(GameState.PLAYING);
    } catch (err) {
      console.error(err);
      setGameState(GameState.IDLE);
    }
  };

  // --- Voice Capture ---
  const startVoiceCapture = () => {
    if (!('webkitSpeechRecognition' in window)) {
      alert('Speech recognition not supported');
      return;
    }
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

  const handleSubmitPrompt = () => {
    if (!prompt.trim()) return;
    setSubmittedPrompt(prompt);
    generateWorld(prompt);
    setPrompt('');
  };

  // --- Render ---
  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute' }} />
      {gameState === GameState.IDLE && (
        <div style={{ position:'absolute',top:0,left:0,width:'100%',height:'100%',
                      zIndex:100,display:'flex',justifyContent:'center',alignItems:'center',
                      backgroundColor:'rgba(0,0,0,0.85)',flexDirection:'column',fontFamily:"'Audiowide', sans-serif",
                      textAlign:'center'}}>
          <h1 style={{ fontSize:'3rem', fontWeight:'bold', background:'linear-gradient(90deg,#ff0000,#ff5555,#990000)',
                       WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',marginBottom:'24px'}}>
            Voice World Builder
          </h1>
          <button onClick={startVoiceCapture}>{isListening ? 'Listening...' : '🎤 Speak'}</button>
          <input type="text" value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Type your prompt..." />
          <button onClick={handleSubmitPrompt}>Submit</button>
          {submittedPrompt && <p>Last prompt: "{submittedPrompt}"</p>}
        </div>
      )}
      {gameState === GameState.GENERATING && (
        <div style={{ position:'absolute',top:0,left:0,width:'100%',height:'100%',
                      zIndex:100,display:'flex',justifyContent:'center',alignItems:'center',
                      backgroundColor:'rgba(0,0,0,0.85)',flexDirection:'column',fontFamily:"'Audiowide', sans-serif",
                      textAlign:'center'}}>
          <h2>Generating World...</h2>
        </div>
      )}
    </div>
  );
};

export default VoiceWorldBuilder;
