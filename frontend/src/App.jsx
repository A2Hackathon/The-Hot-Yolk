import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

const API_BASE = 'http://localhost:8000/api';

const GameState = {
  IDLE: 'idle',
  LISTENING: 'listening',
  GENERATING: 'generating',
  PLAYING: 'playing',
};

const ENEMY_DAMAGE = 1;

const VoiceWorldBuilder = () => {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const animationIdRef = useRef(null);

  const heightmapRef = useRef(null);
  const colorMapRef = useRef(null);
  const terrainMeshRef = useRef(null);
  const playerRef = useRef(null);
  const enemiesRef = useRef([]);
  const structuresRef = useRef([]);

  const [gameState, setGameState] = useState(GameState.IDLE);
  const [isListening, setIsListening] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [submittedPrompt, setSubmittedPrompt] = useState('');
  const [enemyCount, setEnemyCount] = useState(0);

  const playerState = useRef({
    velocity: new THREE.Vector3(),
    isGrounded: false,
    canDoubleJump: true,
    isDashing: false,
    dashTime: 0,
    dashCooldown: 0,
  });

  const cameraOffset = useRef({ distance: 20, height: 12, angle: 0 });
  const pressedKeys = useRef(new Set());

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x87CEEB, 50, 400);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 20, 40);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(100, 150, 100);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.left = -150;
    directionalLight.shadow.camera.right = 150;
    directionalLight.shadow.camera.top = 150;
    directionalLight.shadow.camera.bottom = -150;
    directionalLight.shadow.camera.far = 500;
    scene.add(directionalLight);

    const handleKeyDown = (e) => {
      pressedKeys.current.add(e.key.toLowerCase());
      if (e.key === ' ' && playerRef.current) {
        e.preventDefault();
        if (playerState.current.isGrounded) {
          playerState.current.velocity.y = 0.4;
          playerState.current.isGrounded = false;
        } else if (playerState.current.canDoubleJump) {
          playerState.current.velocity.y = 0.4;
          playerState.current.canDoubleJump = false;
        }
      }
      if ((e.key === 'Shift' || e.key === 'ShiftLeft') && playerRef.current) {
        if (playerState.current.dashCooldown <= 0) {
          playerState.current.isDashing = true;
          playerState.current.dashTime = 0.25;
          playerState.current.dashCooldown = 1.2;
        }
      }
    };
    const handleKeyUp = (e) => pressedKeys.current.delete(e.key.toLowerCase());

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);
      const player = playerRef.current;
      const cam = cameraRef.current;
      
      if (player && cam) {
        const moveSpeed = 0.3;
        const dashSpeed = 1.2;
        const gravity = -0.018;

        if (pressedKeys.current.has('arrowleft')) cameraOffset.current.angle += 0.04;
        if (pressedKeys.current.has('arrowright')) cameraOffset.current.angle -= 0.04;

        let moveVector = new THREE.Vector3();
        if (pressedKeys.current.has('w')) moveVector.z += 1;
        if (pressedKeys.current.has('s')) moveVector.z -= 1;
        if (pressedKeys.current.has('a')) moveVector.x += 1;
        if (pressedKeys.current.has('d')) moveVector.x -= 1;

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

        if (playerState.current.isDashing) {
          playerState.current.dashTime -= 0.016;
          if (playerState.current.dashTime <= 0) playerState.current.isDashing = false;
        } else if (playerState.current.dashCooldown > 0) {
          playerState.current.dashCooldown -= 0.016;
        }

        playerState.current.velocity.y += gravity;
        let newY = player.position.y + playerState.current.velocity.y;

        if (terrainMeshRef.current) {
          const terrainY = getHeightAt(player.position.x, player.position.z) + 2;
          if (newY < terrainY) {
            newY = terrainY;
            playerState.current.velocity.y = 0;
            playerState.current.isGrounded = true;
            playerState.current.canDoubleJump = true;
          } else {
            playerState.current.isGrounded = false;
          }
        }

        player.position.y = newY;

        const { distance, height, angle } = cameraOffset.current;
        const targetX = player.position.x - Math.sin(angle) * distance;
        const targetZ = player.position.z - Math.cos(angle) * distance;
        const targetY = player.position.y + height;
        cam.position.lerp(new THREE.Vector3(targetX, targetY, targetZ), 0.1);
        cam.lookAt(player.position);

        enemiesRef.current.forEach((enemy) => {
          if (!enemy.userData || enemy.userData.health <= 0) return;
          const playerBox = new THREE.Box3().setFromObject(player);
          const enemyBox = new THREE.Box3().setFromObject(enemy);
          if (playerBox.intersectsBox(enemyBox)) {
            if (playerState.current.isDashing || (!playerState.current.isGrounded && !playerState.current.canDoubleJump)) {
              enemy.userData.health -= ENEMY_DAMAGE;
              const originalColor = enemy.material.color.clone();
              enemy.material.color.set(0xff0000);
              setTimeout(() => {
                if (enemy.userData.health > 0) {
                  enemy.material.color.copy(originalColor);
                }
              }, 150);
              if (enemy.userData.health <= 0) {
                sceneRef.current.remove(enemy);
                setEnemyCount(prev => Math.max(0, prev - 1));
              }
            }
          }
        });
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

  const createTerrain = (heightmap, colorMapArray, size = 256) => {
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
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.1 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  };

  const createTree = (treeData) => {
    console.log('[FRONTEND TREE DEBUG] Creating tree:', treeData);
    
    const group = new THREE.Group();
    
    // Trunk
    const trunkGeometry = new THREE.CylinderGeometry(0.3, 0.4, 3, 8);
    const trunkColor = treeData.type === 'pine' || treeData.type === 'spruce' ? 0x654321 : 0x8B4513;
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: trunkColor });
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = 1.5;
    trunk.castShadow = true;
    group.add(trunk);
    
    // CRITICAL: Check leafless property
    const shouldHaveLeaves = treeData.leafless !== true;
    console.log(`[FRONTEND TREE DEBUG] leafless=${treeData.leafless}, shouldHaveLeaves=${shouldHaveLeaves}`);
    
    // Foliage (only if should have leaves)
    if (shouldHaveLeaves) {
      let foliage;
      if (treeData.type === 'pine' || treeData.type === 'spruce') {
        // Cone shape for pine/spruce
        const coneGeometry = new THREE.ConeGeometry(1.5, 4, 8);
        const coneMaterial = new THREE.MeshStandardMaterial({ color: 0x0d5c0d });
        foliage = new THREE.Mesh(coneGeometry, coneMaterial);
        foliage.position.y = 5;
      } else {
        // Sphere for oak/maple/birch
        const sphereGeometry = new THREE.SphereGeometry(2, 8, 8);
        const sphereMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22 });
        foliage = new THREE.Mesh(sphereGeometry, sphereMaterial);
        foliage.position.y = 4;
      }
      foliage.castShadow = true;
      group.add(foliage);
      console.log('[FRONTEND TREE DEBUG] Added foliage');
    } else {
      console.log('[FRONTEND TREE DEBUG] NO foliage - leafless tree!');
    }
    
    group.position.set(treeData.position.x, treeData.position.y, treeData.position.z);
    group.scale.setScalar(treeData.scale);
    group.rotation.y = treeData.rotation;
    
    return group;
  };

  const createRock = (rockData) => {
    const geometry = new THREE.DodecahedronGeometry(1, 0);
    const color = rockData.type === 'ice_rock' ? 0xCCE5FF : 0x808080;
    const material = new THREE.MeshStandardMaterial({ 
      color: color, 
      roughness: 0.8,
      metalness: 0.2
    });
    const rock = new THREE.Mesh(geometry, material);
    rock.position.set(rockData.position.x, rockData.position.y + 0.5, rockData.position.z);
    rock.scale.setScalar(rockData.scale);
    rock.rotation.set(
      Math.random() * Math.PI,
      rockData.rotation,
      Math.random() * Math.PI
    );
    rock.castShadow = true;
    return rock;
  };

  const createMountainPeak = (peakData) => {
    const geometry = new THREE.ConeGeometry(3, 8, 6);
    const material = new THREE.MeshStandardMaterial({ 
      color: 0xF0F0F0,
      emissive: 0x888888,
      emissiveIntensity: 0.2
    });
    const peak = new THREE.Mesh(geometry, material);
    peak.position.set(peakData.position.x, peakData.position.y + 4, peakData.position.z);
    peak.scale.setScalar(peakData.scale);
    peak.castShadow = true;
    return peak;
  };

  const createPlayer = (spawn) => {
    const geometry = new THREE.CylinderGeometry(1, 1, 4, 16);
    const material = new THREE.MeshStandardMaterial({ 
      color: 0x4444ff,
      emissive: 0x2222aa,
      emissiveIntensity: 0.3
    });
    const player = new THREE.Mesh(geometry, material);
    const y = getHeightAt(spawn.x, spawn.z) + 2;
    player.position.set(spawn.x, y, spawn.z);
    player.castShadow = true;
    return player;
  };

  const getHeightAt = (x, z, size = 256) => {
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
      const material = new THREE.MeshStandardMaterial({ 
        color: 0xff2222,
        emissive: 0x990000,
        emissiveIntensity: 0.4
      });
      const enemy = new THREE.Mesh(geometry, material);
      const worldX = e.position.x;
      const worldZ = e.position.z;
      const worldY = getHeightAt(worldX, worldZ) + 2;
      enemy.position.set(worldX, worldY, worldZ);
      enemy.castShadow = true;
      enemy.userData = { health: 3, maxHealth: 3, id: e.id };
      return enemy;
    });
  };

  const generateWorld = async (promptText) => {
    setGameState(GameState.GENERATING);
    try {
      const res = await fetch(`${API_BASE}/generate-world`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText }),
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      console.log("=== FRONTEND: Full API response ===");
      console.log(JSON.stringify(data, null, 2));

      const scene = sceneRef.current;
      if (!scene) return;

      const objectsToRemove = [];
      scene.children.forEach((child) => {
        if (!child.isLight) objectsToRemove.push(child);
      });
      objectsToRemove.forEach((obj) => scene.remove(obj));
      
      terrainMeshRef.current = null;
      enemiesRef.current = [];
      structuresRef.current = [];

      if (data.world && data.world.lighting_config) {
        console.log('[FRONTEND LIGHTING DEBUG] Applying lighting:', data.world.lighting_config);
        updateLighting(data.world.lighting_config);
      }

      if (data.world && data.world.heightmap_raw && data.world.colour_map_array) {
        heightmapRef.current = data.world.heightmap_raw;
        colorMapRef.current = data.world.colour_map_array;
        const terrainMesh = createTerrain(heightmapRef.current, colorMapRef.current, 256);
        terrainMeshRef.current = terrainMesh;
        scene.add(terrainMesh);
      }

      // Add structures (trees, rocks, peaks)
      if (data.structures) {
        if (data.structures.trees) {
          console.log(`[FRONTEND] Creating ${data.structures.trees.length} trees...`);
          console.log('[FRONTEND] First tree data:', data.structures.trees[0]);
          
          data.structures.trees.forEach((treeData, index) => {
            const tree = createTree(treeData);
            scene.add(tree);
            structuresRef.current.push(tree);
          });
          console.log(`✓ Added ${data.structures.trees.length} trees`);
        }
        
        if (data.structures.rocks) {
          data.structures.rocks.forEach(rockData => {
            const rock = createRock(rockData);
            scene.add(rock);
            structuresRef.current.push(rock);
          });
          console.log(`✓ Added ${data.structures.rocks.length} rocks`);
        }
        
        if (data.structures.peaks) {
          data.structures.peaks.forEach(peakData => {
            const peak = createMountainPeak(peakData);
            scene.add(peak);
            structuresRef.current.push(peak);
          });
          console.log(`✓ Added ${data.structures.peaks.length} mountain peaks`);
        }
      }

      const spawn = data.spawn_point || { x: 0, z: 0 };
      const playerMesh = createPlayer(spawn);
      playerRef.current = playerMesh;
      scene.add(playerMesh);

      if (data.combat && data.combat.enemies && data.combat.enemies.length > 0) {
        enemiesRef.current = createEnemies(data.combat.enemies);
        enemiesRef.current.forEach((e) => scene.add(e));
        setEnemyCount(enemiesRef.current.length);
      } else {
        enemiesRef.current = [];
        setEnemyCount(0);
      }

      setGameState(GameState.PLAYING);
    } catch (err) {
      console.error("World generation error:", err);
      alert("Failed to generate world. Check console.");
      setGameState(GameState.IDLE);
    }
  };

  const updateLighting = (lightingConfig) => {
    const scene = sceneRef.current;
    if (!scene) return;
    
    console.log('[FRONTEND LIGHTING] Updating scene lighting...');
    
    const ambientLight = scene.children.find(c => c.isAmbientLight);
    if (ambientLight) {
      ambientLight.color.setStyle(lightingConfig.ambient.color);
      ambientLight.intensity = lightingConfig.ambient.intensity;
      console.log(`[FRONTEND LIGHTING] Ambient: ${lightingConfig.ambient.color} @ ${lightingConfig.ambient.intensity}`);
    }
    
    const directionalLight = scene.children.find(c => c.isDirectionalLight);
    if (directionalLight) {
      directionalLight.color.setStyle(lightingConfig.directional.color);
      directionalLight.intensity = lightingConfig.directional.intensity;
      directionalLight.position.set(
        lightingConfig.directional.position.x,
        lightingConfig.directional.position.y,
        lightingConfig.directional.position.z
      );
      console.log(`[FRONTEND LIGHTING] Directional: ${lightingConfig.directional.color} @ ${lightingConfig.directional.intensity}`);
    }
    
    scene.fog.color.setStyle(lightingConfig.fog.color);
    scene.fog.near = lightingConfig.fog.near;
    scene.fog.far = lightingConfig.fog.far;
    console.log(`[FRONTEND LIGHTING] Fog: ${lightingConfig.fog.color} (${lightingConfig.fog.near}-${lightingConfig.fog.far})`);
    
    scene.background = new THREE.Color(lightingConfig.background);
    console.log(`[FRONTEND LIGHTING] Background: ${lightingConfig.background}`);
  };

  const startVoiceCapture = () => {
    if (!('webkitSpeechRecognition' in window)) {
      return alert('Speech recognition not supported. Use Chrome or Edge.');
    }
    const recognition = new webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      console.log("Voice:", transcript);
      setIsListening(false);
      setSubmittedPrompt(transcript);
      generateWorld(transcript);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  const handleTextSubmit = () => {
    if (!prompt.trim()) return;
    setSubmittedPrompt(prompt);
    generateWorld(prompt);
    setPrompt('');
  };

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative', background: '#000' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute' }} />

      {gameState === GameState.PLAYING && (
        <div style={{
          position: 'absolute', top: 20, left: 20, zIndex: 10,
          backgroundColor: 'rgba(0,0,0,0.7)', padding: '15px', borderRadius: '8px',
          color: '#fff', fontFamily: 'monospace', fontSize: '14px'
        }}>
          <div>Enemies: {enemyCount}</div>
          <div style={{ marginTop: '10px', fontSize: '12px', opacity: 0.8 }}>
            <div>WASD - Move</div>
            <div>Space - Jump (2x)</div>
            <div>Shift - Dash</div>
            <div>Arrows - Rotate Cam</div>
          </div>
        </div>
      )}

      {gameState === GameState.IDLE && (
        <div style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 100,
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          backgroundColor: 'rgba(0,0,0,0.95)', flexDirection: 'column', fontFamily: 'Arial',
          textAlign: 'center', padding: '20px'
        }}>
          <h1 style={{
            fontSize: '3.5rem', fontWeight: 'bold', 
            background: 'linear-gradient(90deg, #4444ff, #8888ff, #4444ff)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', 
            marginBottom: '20px'
          }}>Voice World Builder</h1>
          
          <p style={{ color: '#aaa', marginBottom: '30px', maxWidth: '600px' }}>
            Try: "Arctic mountains with trees" or "City with trees at sunset"
          </p>

          <button onClick={startVoiceCapture} disabled={isListening} style={{
            padding: '15px 40px', fontSize: '18px', fontWeight: 'bold',
            background: isListening ? '#666' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: '#fff', border: 'none', borderRadius: '50px', cursor: isListening ? 'not-allowed' : 'pointer',
            boxShadow: '0 4px 15px rgba(102, 126, 234, 0.4)', marginBottom: '20px'
          }}>
            {isListening ? '🎙️ Listening...' : '🎙️ Speak to Create'}
          </button>

          <div style={{ display: 'flex', gap: '10px', width: '100%', maxWidth: '500px' }}>
            <input type="text" value={prompt} onChange={e => setPrompt(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && handleTextSubmit()}
              placeholder="Or type prompt..." style={{
                flex: 1, padding: '12px 20px', fontSize: '16px',
                background: 'rgba(255,255,255,0.1)', color: '#fff', border: '2px solid rgba(255,255,255,0.3)',
                borderRadius: '25px', outline: 'none'
              }}
            />
            <button onClick={handleTextSubmit} style={{
              padding: '12px 30px', fontSize: '16px', fontWeight: 'bold',
              background: '#4CAF50', color: '#fff', border: 'none', borderRadius: '25px', cursor: 'pointer'
            }}>Generate</button>
          </div>
          {submittedPrompt && <p style={{ color: '#888', marginTop: '20px', fontSize: '14px' }}>Last: "{submittedPrompt}"</p>}
        </div>
      )}

      {gameState === GameState.GENERATING && (
        <div style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 100,
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          backgroundColor: 'rgba(0,0,0,0.9)', flexDirection: 'column'
        }}>
          <div style={{
            width: '80px', height: '80px', border: '8px solid rgba(255,255,255,0.1)',
            borderTop: '8px solid #4444ff', borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
          <h2 style={{ color: '#fff', marginTop: '30px', fontSize: '24px' }}>Generating World...</h2>
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        </div>
      )}
    </div>
  );
};

export default VoiceWorldBuilder;