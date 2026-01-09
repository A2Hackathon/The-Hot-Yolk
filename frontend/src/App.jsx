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
  const terrainPlacementMaskRef = useRef(null);
  const [currentWorld, setCurrentWorld] = useState(null);
  const terrainMeshRef = useRef(null);
  const playerRef = useRef(null);
  const enemiesRef = useRef([]);
  const structuresRef = useRef([]);

  const [gameState, setGameState] = useState(GameState.IDLE);
  const [isListening, setIsListening] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [modifyPrompt, setModifyPrompt] = useState('');
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

  const cameraOffset = useRef({
    distance: 20,  // distance from player
    height: 12,    // base height above player
    angle: 0,      // horizontal rotation (yaw)
    pitch: 0       // vertical rotation (pitch)
  });

  const pressedKeys = useRef(new Set());

  // --- Hybrid placement function ---
  function placeObjectHybrid({
    placementMask,
    placedSmallObjects,
    scene,
    terrainHeightFn,
    object3D,
    objectSize = { width: 2, depth: 2 },
    maxAttempts = 20
  }) {
    const maskHeight = placementMask.length;
    const maskWidth = placementMask[0].length;

    const isWalkable = (x, z) => {
      const xi = Math.floor(x);
      const zi = Math.floor(z);
      return (
        xi >= 0 &&
        xi < maskWidth &&
        zi >= 0 &&
        zi < maskHeight &&
        placementMask[zi][xi] === 1
      );
    };

    const isOverlapping = (x, z, width, depth, existingObjects) => {
      const halfW = width / 2;
      const halfD = depth / 2;
      const minX = x - halfW, maxX = x + halfW;
      const minZ = z - halfD, maxZ = z + halfD;

      return existingObjects.some(obj => {
        const oMinX = obj.x - obj.width / 2;
        const oMaxX = obj.x + obj.width / 2;
        const oMinZ = obj.z - obj.depth / 2;
        const oMaxZ = obj.z + obj.depth / 2;

        const overlapX = maxX > oMinX && minX < oMaxX;
        const overlapZ = maxZ > oMinZ && minZ < oMaxZ;
        return overlapX && overlapZ;
      });
    };

    const placedLargeObjects = [];

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const x = Math.random() * maskWidth;
      const z = Math.random() * maskHeight;

      if (!isWalkable(x, z)) continue;

      const tooCloseToSmall = placedSmallObjects.some(p =>
        Math.hypot(p.x - x, p.z - z) < 2
      );
      if (tooCloseToSmall) continue;

      if (isOverlapping(x, z, objectSize.width, objectSize.depth, placedLargeObjects))
        continue;

      const y = terrainHeightFn(x, z);
      object3D.position.set(x, y, z);
      scene.add(object3D);

      placedLargeObjects.push({ x, z, width: objectSize.width, depth: objectSize.depth });
      return true;
    }

    console.warn("Failed to place object after max attempts");
    return false;
  }

  useEffect(() => {
    if (!containerRef.current) return;

    // --- Scene Lighting & Shadows Setup ---
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x87CEEB); // light sky-blue for arctic

    // Instead of ShadowMaterial
    const planeMaterial = new THREE.MeshStandardMaterial({
      color: 0xA5BDF5,    // your icy purple
      roughness: 0.8,
      metalness: 0.1,
    });

    // Keep the plane large
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1000, 1000),
      planeMaterial
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = 0;
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);

    // --- Ambient Light (faint purple fill) ---
    const ambientLight = new THREE.AmbientLight(0xA5BDF5, 0.25);
    scene.add(ambientLight);

    // --- Directional Light (sun / main shadow caster) ---
    const directionalLight = new THREE.DirectionalLight(0xaaaaff, 1.0);
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

    // --- Renderer setup ---
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // smooth shadows
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 10, 20);
    cameraRef.current = camera;
    scene.add(camera); // optional, not strictly needed

    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

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
    const handleKeyUp = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }
      pressedKeys.current.delete(e.key.toLowerCase());
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const animate = () => {
      updateEnemyHealthBars();
      animationIdRef.current = requestAnimationFrame(animate);
      const player = playerRef.current;
      const cam = cameraRef.current;
      
      if (player && cam) {
        // Get camera direction
        const camDir = new THREE.Vector3();
        cam.getWorldDirection(camDir);
        camDir.y = 0; // ignore vertical component
        camDir.normalize();


        const targetYaw = Math.atan2(camDir.x, camDir.z);

        // Smooth interpolation: 0.1 = speed of rotation
        player.rotation.y += ((targetYaw - player.rotation.y + Math.PI) % (2 * Math.PI) - Math.PI) * 0.1;


        const moveSpeed = 0.3;
        const dashSpeed = 1.2;
        const gravity = -0.018;

        if (pressedKeys.current.has('arrowleft')) cameraOffset.current.angle += 0.04;
        if (pressedKeys.current.has('arrowright')) cameraOffset.current.angle -= 0.04;
        // Inside handleKeyDown / handleKeyUp logic
        if (pressedKeys.current.has('arrowup')) cameraOffset.current.pitch += 0.02;
        if (pressedKeys.current.has('arrowdown')) cameraOffset.current.pitch -= 0.02;

        // Clamp pitch so camera can't flip
        cameraOffset.current.pitch = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, cameraOffset.current.pitch));


        let moveVector = new THREE.Vector3();
        if (pressedKeys.current.has('w')) moveVector.z += 1;
        if (pressedKeys.current.has('s')) moveVector.z -= 1;
        if (pressedKeys.current.has('a')) moveVector.x += 1; 
        if (pressedKeys.current.has('d')) moveVector.x -= 1; 

        if (moveVector.length() > 0 && player) {
          moveVector.normalize();
          const speed = playerState.current.isDashing ? dashSpeed : moveSpeed;

          const camForward = new THREE.Vector3();
          cameraRef.current.getWorldDirection(camForward);
          camForward.y = 0;
          camForward.normalize();

          const camRight = new THREE.Vector3();
          camRight.crossVectors(new THREE.Vector3(0, 1, 0), camForward).normalize();

          const moveDir = new THREE.Vector3();
          moveDir.addScaledVector(camForward, moveVector.z);
          moveDir.addScaledVector(camRight, moveVector.x);
          moveDir.normalize();

          // Move player
          player.position.addScaledVector(moveDir, speed);

          // Roll egg
          const egg = player.children[0];
          const rollAxis = new THREE.Vector3(-moveDir.z, 0, moveDir.x); 
          egg.rotateOnWorldAxis(rollAxis, speed * 0.15);
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

        const { distance, height, angle, pitch } = cameraOffset.current;

        // Calculate horizontal circle around player
        const offsetX = -Math.sin(angle) * distance;
        const offsetZ = -Math.cos(angle) * distance;

        // Vertical offset influenced by pitch
        const offsetY = height + Math.sin(pitch) * distance;

        // Target camera position
        const targetPos = new THREE.Vector3(
          player.position.x + offsetX,
          player.position.y + offsetY,
          player.position.z + offsetZ
        );

        // Smoothly move camera
        cam.position.lerp(targetPos, 0.1);

        // Look at player with a slight vertical adjustment based on pitch
        const lookAtY = player.position.y + Math.sin(pitch) * 2; // tweak multiplier for natural feel
        cam.lookAt(player.position.x, lookAtY, player.position.z);

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

        enemiesRef.current = enemiesRef.current.filter(enemy => {
        if (!enemy.userData || enemy.userData.health <= 0) {
          if (sceneRef.current) sceneRef.current.remove(enemy);
          return false;
        }
        return true;
        });
        setEnemyCount(enemiesRef.current.length);
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
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  };

  const createTree = (treeData) => {
    console.log('[FRONTEND TREE DEBUG] Creating tree:', treeData);

    const group = new THREE.Group();

  // --- Trunk (Minecraft-style blocky) ---
  const trunkHeight = 3 * treeData.scale;
  const trunkRadius = 0.4 * treeData.scale;

  const blockHeight = 0.5 * treeData.scale;
  const blockCount = Math.floor(trunkHeight / blockHeight);

  const trunkMaterial = new THREE.MeshStandardMaterial({
    color: 0x654321,
    roughness: 1.0,
    metalness: 0.0,
    flatShading: true
  });

  for (let i = 0; i < blockCount; i++) {
    const jitter = (Math.random() - 0.5) * 0.08 * treeData.scale;

    const block = new THREE.Mesh(
      new THREE.BoxGeometry(
        trunkRadius * 2 + jitter,
        blockHeight,
        trunkRadius * 2 + jitter
      ),
      trunkMaterial
    );

    block.position.y = i * blockHeight + blockHeight / 2;
    block.castShadow = true;
    group.add(block);
  }


    // --- Foliage ---
    if (treeData.leafless) {
      // Arctic biome: pyramid-style leaves

      if (treeData.leafless) {
        // Arctic biome: pyramid-style leaves
        const leafCount = 4;
        const leafWidth = 3 * treeData.scale;
        const leafHeight = 1.5 * treeData.scale;

        for (let i = 0; i < leafCount; i++) {
          const w = leafWidth - i * 0.6 * treeData.scale; // taper each layer
          const h = leafHeight;

          // Geometry
          const geometry = new THREE.BoxGeometry(w, h, w);

          // Vertex colors: bottom half green, top half white
          const colorAttr = [];
          const green = new THREE.Color(0x4BBB6D);
          const white = new THREE.Color(0xffffff);

          for (let v = 0; v < geometry.attributes.position.count; v++) {
            const y = geometry.attributes.position.getY(v);
            const t = (y + h/2) / h; // normalize y from 0 (bottom) to 1 (top)
            if (t < 0.5) {
              colorAttr.push(green.r, green.g, green.b);
            } else {
              colorAttr.push(white.r, white.g, white.b);
            }
          }
          geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorAttr, 3));

          const material = new THREE.MeshStandardMaterial({ vertexColors: true });
          const leaf = new THREE.Mesh(geometry, material);
          leaf.position.y = trunkHeight + i * leafHeight + leafHeight / 2;
          leaf.castShadow = true;
          group.add(leaf);
        }
      }
    } else {
      // --- Foliage for non-leafless trees (fully green Christmas tree style) ---
      const leafCount = 5; // number of stacked layers
      const leafWidth = 4 * treeData.scale;
      const leafHeight = 1.2 * treeData.scale;

      for (let i = 0; i < leafCount; i++) {
        const w = leafWidth - i * 0.7 * treeData.scale; // taper each layer
        const h = leafHeight;

        const geometry = new THREE.BoxGeometry(w, h, w);

        // Fully green for all vertices
        const colorAttr = [];
        const green = new THREE.Color(0x0d5c0d);
        for (let v = 0; v < geometry.attributes.position.count; v++) {
          colorAttr.push(green.r, green.g, green.b);
        }
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorAttr, 3));

        const material = new THREE.MeshStandardMaterial({ vertexColors: true });
        const leaf = new THREE.Mesh(geometry, material);
        leaf.position.y = trunkHeight + i * leafHeight + leafHeight / 2;
        leaf.castShadow = true;
        group.add(leaf);
      }


    }

    // --- Position, scale, rotation ---
    group.position.set(treeData.position.x, treeData.position.y, treeData.position.z);
    group.scale.setScalar(treeData.scale);
    group.rotation.y = treeData.rotation || 0;
group.traverse(child => {
  if (child.isMesh) {
    child.matrixAutoUpdate = false;
    child.updateMatrix();
  }
});

group.userData.static = true;
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

  const createBuilding = (buildingData) => {
    const group = new THREE.Group();
    
    const height = (buildingData.height || 10) ;
    const width = (buildingData.width || 4);
    const depth = (buildingData.depth || 4);
    
    // Main building body
    const bodyGeom = new THREE.BoxGeometry(width, height, depth);
    const bodyMat = new THREE.MeshStandardMaterial({ 
      color: buildingData.color || 0x888888,
      roughness: 0.7,
      metalness: 0.3
    });
    // Move geometry so base sits at y = 0
bodyGeom.translate(0, height / 2, 0);

const body = new THREE.Mesh(bodyGeom, bodyMat);
body.position.y = 0;

    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    
    // Windows (simple grid pattern)
    const windowSize = 0.5;
    const windowSpacing = 1.5;
    const windowColor = 0x4444ff;
    
    for (let y = 2; y < height - 1; y += windowSpacing) {
      for (let x = -width/2 + 1; x < width/2; x += windowSpacing) {
        // Front windows
        const windowGeom = new THREE.BoxGeometry(windowSize, windowSize, 0.1);
        const windowMat = new THREE.MeshStandardMaterial({ 
          color: windowColor,
          emissive: windowColor,
          emissiveIntensity: 0.3
        });
        const window1 = new THREE.Mesh(windowGeom, windowMat);
        window1.position.set(x, y, depth/2 + 0.05);
        group.add(window1);
        
        // Back windows
        const window2 = new THREE.Mesh(windowGeom, windowMat.clone());
        window2.position.set(x, y, -depth/2 - 0.05);
        group.add(window2);
      }
      
      for (let z = -depth/2 + 1; z < depth/2; z += windowSpacing) {
        // Side windows
        const windowGeom = new THREE.BoxGeometry(0.1, windowSize, windowSize);
        const windowMat = new THREE.MeshStandardMaterial({ 
          color: windowColor,
          emissive: windowColor,
          emissiveIntensity: 0.3
        });
        const window3 = new THREE.Mesh(windowGeom, windowMat);
        window3.position.set(width/2 + 0.05, y, z);
        group.add(window3);
        
        const window4 = new THREE.Mesh(windowGeom, windowMat.clone());
        window4.position.set(-width/2 - 0.05, y, z);
        group.add(window4);
      }
    }
    
    group.position.set(
      buildingData.position.x, 
      0,
      buildingData.position.z
    );
    group.rotation.y = buildingData.rotation || 0;
   
    
    return group;
  };

  const createMountainPeak = (peakData) => {
    const geometry = new THREE.ConeGeometry(100, 100, 4);
    const material = new THREE.MeshStandardMaterial({ 
      color: 0xF0F0F0,
      emissive: 0x888888,
      emissiveIntensity: 0.2
    });
    const peak = new THREE.Mesh(geometry, material);
    peak.position.set(peakData.position.x, peakData.position.y + 50, peakData.position.z);
    peak.scale.setScalar(peakData.scale);
    peak.rotation.y = Math.random() * Math.PI * 2; // break symmetry
    peak.castShadow = true;
    return peak;
  };
    
  const getHeightAt = (x, z) => {
    if (!heightmapRef.current) return 0; // default flat ground
    const hm = heightmapRef.current;
    const size = hm.length;
    
    // Map world coordinates to heightmap indices
    const terrainSize = 256; // should match your PlaneGeometry size
    const halfSize = terrainSize / 2;

    const col = Math.floor(((x + halfSize) / terrainSize) * (size - 1));
    const row = Math.floor(((z + halfSize) / terrainSize) * (size - 1));

    // Clamp indices
    const r = Math.max(0, Math.min(size - 1, row));
    const c = Math.max(0, Math.min(size - 1, col));

    return hm[r][c] * 10; // multiply by terrain height scale (same as createTerrain)
  };


  const createPlayer = (spawn) => {
    const group = new THREE.Group();
    const yOffset = getHeightAt(spawn.x, spawn.z);

    // --- Egg body (horizontal ellipsoid) ---
    const geometry = new THREE.SphereGeometry(1, 32, 32);
    geometry.scale(1, 1, 1.4); // elongated along Z-axis for horizontal egg
    const material = new THREE.MeshStandardMaterial({ color: 0xffffdd, roughness: 0.5, metalness: 0.1 });
    const egg = new THREE.Mesh(geometry, material);
    egg.castShadow = true;
    egg.receiveShadow = true;

    // Rotate so egg lies horizontally along Z
    egg.rotation.x = Math.PI / 2;

    group.add(egg);

    // --- Position in world ---
    group.position.set(spawn.x, yOffset + 1, spawn.z); // half height offset

    return group;
  };


  const createEnemies = (position, id) => {
    const group = new THREE.Group();

    // --- Body ---
    const bodyGeom = new THREE.BoxGeometry(2, 2, 2);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 1; // half height
    body.castShadow = true;
    group.add(body);

    // --- Head ---
    const headGeom = new THREE.BoxGeometry(1.2, 1.2, 1.2); // slightly smaller
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const head = new THREE.Mesh(headGeom, headMat);
    head.position.set(0, 2.5, 0.2); // slightly forward
    group.add(head);

    // --- Beak ---
    const beakGeom = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    const beakMat = new THREE.MeshStandardMaterial({ color: 0xffa500 }); // orange
    const beak = new THREE.Mesh(beakGeom, beakMat);
    beak.position.set(0, 2.5, 0.9); // in front of head
    group.add(beak);

    // --- Comb ---
    const combGeom = new THREE.BoxGeometry(0.4, 0.4, 0.2);
    const combMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const comb = new THREE.Mesh(combGeom, combMat);
    comb.position.set(0, 3.1, 0.0); // top of head
    group.add(comb);

    // --- Feet ---
    const footGeom = new THREE.BoxGeometry(0.3, 0.7, 0.3); // taller
    const footMat = new THREE.MeshStandardMaterial({ color: 0xffa500 });
    const leftFoot = new THREE.Mesh(footGeom, footMat);
    leftFoot.position.set(-0.5, 0.35, 0.3); // slightly forward
    const rightFoot = new THREE.Mesh(footGeom, footMat);
    rightFoot.position.set(0.5, 0.35, 0.3);
    group.add(leftFoot, rightFoot);

    // --- Health bar ---
    const healthBarBgGeom = new THREE.BoxGeometry(2.5, 0.2, 0.3);
    const healthBarBgMat = new THREE.MeshBasicMaterial({ color: 0x444444 });
    const healthBarBg = new THREE.Mesh(healthBarBgGeom, healthBarBgMat);
    healthBarBg.position.set(0, 3.5, 0);
    group.add(healthBarBg);

    const healthBarGeom = new THREE.BoxGeometry(2.5, 0.2, 0.3);
    const healthBarMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const healthBar = new THREE.Mesh(healthBarGeom, healthBarMat);
    healthBar.position.set(0, 0, 0.01); // in front of bg
    healthBarBg.add(healthBar);

    group.userData = { health: 3, maxHealth: 3, id, healthBar };

    // --- Position in world ---
    group.position.set(position.x, getHeightAt(position.x, position.z), position.z);

    return group;
  };



  const updateEnemyHealthBars = () => {
    const cam = cameraRef.current;
    if (!cam) return;

    enemiesRef.current.forEach((enemy) => {
      if (!enemy.userData || !enemy.userData.healthBar) return;

      const { health, maxHealth, healthBar } = enemy.userData;
      const scale = Math.max(0, health / maxHealth);
      healthBar.scale.x = scale;
      healthBar.position.x = -(3 * (1 - scale)) / 2;

      // Color based on health
      if (scale > 0.5) healthBar.material.color.set(0x00ff00);
      else if (scale > 0.25) healthBar.material.color.set(0xffff00);
      else healthBar.material.color.set(0xff0000);

      // Make health bar face camera
      const worldPos = new THREE.Vector3();
      healthBar.getWorldPosition(worldPos);
      healthBar.lookAt(cam.position.x, healthBar.position.y, cam.position.z);
    });
  };

  // --- Add simple rectangular clouds ---
  const createCloud = (x, y, z, scale = 1) => {
    const cloudGroup = new THREE.Group();
    const boxCount = 3 + Math.floor(Math.random() * 3); // 3-5 boxes per cloud
    for (let i = 0; i < boxCount; i++) {
      const width = 5 * scale + Math.random() * 5 * scale;
      const height = 2 * scale + Math.random() * 2 * scale;
      const depth = 3 * scale + Math.random() * 3 * scale;

      const geometry = new THREE.BoxGeometry(width, height, depth);
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.8,
        metalness: 0.1,
      });

      const box = new THREE.Mesh(geometry, material);
      box.position.set(
        (Math.random() - 0.5) * 10 * scale,
        (Math.random() - 0.5) * 4 * scale,          
        (Math.random() - 0.5) * 5 * scale
      );
      box.castShadow = true;
      cloudGroup.add(box);
    }
    cloudGroup.position.set(x, y, z);
    return cloudGroup;
  };

  const generateWorld = async (promptText) => {
    setGameState(GameState.GENERATING);
    try {
      const res = await fetch(`${API_BASE}/generate-world`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText }),
      });
        if (!res.ok) {
        const errorText = await res.text();
        console.error('API Error Response:', errorText);
        throw new Error(`API error: ${res.status} - ${errorText}`);
      }
      const data = await res.json();
      console.log("=== FRONTEND: Full API response ===");
      console.log(JSON.stringify(data, null, 2));

          // ✅ Validate data structure
      if (!data.world) {
        throw new Error('Invalid response: missing world data');
      }
      setCurrentWorld(data);

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
        terrainPlacementMaskRef.current = heightmapRef.current.map(row =>
          row.map(height => (height >= 0 ? 1 : 0)) // example: everything above 0 is walkable
        );
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

        // Create multiple clouds
        const cloudCount = 30;
        for (let i = 0; i < cloudCount; i++) {
          const x = (Math.random() - 0.5) * 500;
          const y = 40 + Math.random() * 90;
          const z = (Math.random() - 0.5) * 500;
          const scale = 3 + Math.random() * 0.5;
          const cloud = createCloud(x, y, z, scale);
          scene.add(cloud);
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
        if (data.structures.buildings) {
  data.structures.buildings.forEach(buildingData => {
    const building = createBuilding(buildingData);

    const placed = placeObjectHybrid({
  placementMask: terrainPlacementMaskRef.current,
  placedSmallObjects: structuresRef.current.map(obj => ({
    x: obj.position.x,
    z: obj.position.z
  })),
  scene,
  terrainHeightFn: getHeightAt,
  object3D: building,
  objectSize: {
    width: (buildingData.width || 4),
    depth: (buildingData.depth || 4)
  },
  maxAttempts: 40
});

// ✅ SNAP TO TERRAIN SURFACE
if (placed) {
  const terrainY = getHeightAt(
    building.position.x,
    building.position.z
  );
  building.position.y = terrainY;
}

structuresRef.current.push(building);

  });
}

      }

      const spawn = data.spawn_point || { x: 0, z: 0 };
      const playerMesh = createPlayer(spawn);
      playerRef.current = playerMesh;
      scene.add(playerMesh);

      if (data.combat && data.combat.enemies) {
        enemiesRef.current = data.combat.enemies.map((enemyData, idx) => {
          // Ensure position exists
          if (!enemyData.position) enemyData.position = { x: 0, z: 0 };
          if (typeof enemyData.position.x !== 'number') enemyData.position.x = 0;
          if (typeof enemyData.position.z !== 'number') enemyData.position.z = 0;

          const terrainHalf = 128;
          enemyData.position.x = Math.max(-terrainHalf, Math.min(terrainHalf, enemyData.position.x));
          enemyData.position.z = Math.max(-terrainHalf, Math.min(terrainHalf, enemyData.position.z));

          const enemy = createEnemies(enemyData.position, idx);
          scene.add(enemy);
          return enemy;
        });
        setEnemyCount(enemiesRef.current.length);
      }
      setGameState(GameState.PLAYING);
    } catch (err) {
      console.error("World generation error:", err);
      alert("Failed to generate world. Check console.");
      setGameState(GameState.IDLE);
    }
  };

  const modifyWorld = async (commandText) => {
    console.log("=== MODIFY WORLD CALLED ===");
    console.log("Command:", commandText);
    console.log("Current world exists:", !!currentWorld);
    setGameState(GameState.GENERATING);
    try {
      const payload = {
        command: commandText,
        current_world: currentWorld,
        from_time: null,       
        to_time: null,         
        progress: 1.0,          
      };

      const res = await fetch(`${API_BASE}/modify-world`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      console.log("API response status:", res.status);

      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      console.log("=== FRONTEND: Modify response ===", data);

      const scene = sceneRef.current;
      if (!scene) return;

      const oldWorld = currentWorld;
      console.log("Old world structures:", oldWorld?.structures);
      console.log("New world structures:", data?.structures);

      if (data.structures?.trees) {
        const existingTreeCount = oldWorld?.structures?.trees?.length || 0;
        const newTrees = data.structures.trees.slice(existingTreeCount);
        
        console.log(`[MODIFY] Adding ${newTrees.length} new trees...`);
        
        newTrees.forEach(treeData => {
          const tree = createTree(treeData);

          placeObjectHybrid({
            placementMask: terrainPlacementMaskRef.current,
            placedSmallObjects: structuresRef.current.map(obj => ({ x: obj.position.x, z: obj.position.z })),
            scene,
            terrainHeightFn: (x, z) => getHeightAt(x, z),
            object3D: tree,
            objectSize: { width: 1, depth: 1 },
            maxAttempts: 20
          });

          structuresRef.current.push(tree);
        });
      }

      if (data.structures?.rocks) {
        const existingRockCount = oldWorld?.structures?.rocks?.length || 0;
        const newRocks = data.structures.rocks.slice(existingRockCount);
        
        console.log(`[MODIFY] Adding ${newRocks.length} new rocks...`);
        
        newRocks.forEach(rockData => {
          const rock = createRock(rockData);

          placeObjectHybrid({
            placementMask: terrainPlacementMaskRef.current,
            placedSmallObjects: structuresRef.current.map(obj => ({ x: obj.position.x, z: obj.position.z })),
            scene,
            terrainHeightFn: (x, z) => getHeightAt(x, z),
            object3D: rock,
            objectSize: { width: 3, depth: 3 },
            maxAttempts: 20
          });

          structuresRef.current.push(rock);
        });
      }

      // Update lighting
      if (data.world?.lighting_config) {
        console.log('[MODIFY] Updating lighting...');
        updateLighting(data.world.lighting_config);
      } else {
        console.log('[MODIFY] No lighting changes');
      }

      // Update physics
      if (data.physics) {
        console.log('[MODIFY] Updating physics...');
        playerState.current = { ...playerState.current, ...data.physics };
      }

      // NOW update React state AFTER all calculations
      setCurrentWorld(data);
      
      setGameState(GameState.PLAYING);
      console.log("✓ Returned to PLAYING state");
    } catch (err) {
      console.error("Modify-world error:", err);
      setGameState(GameState.PLAYING);
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
        
    scene.background = new THREE.Color(lightingConfig.background);
    console.log(`[FRONTEND LIGHTING] Background: ${lightingConfig.background}`);
  };

  const startVoiceCapture = (forceModify = false) => {
    if (!('webkitSpeechRecognition' in window)) {
      return alert('Speech recognition not supported. Use Chrome or Edge.');
    }

    const recognition = new webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => setIsListening(true);
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      console.log("Voice:", transcript);
      setIsListening(false);
      setSubmittedPrompt(transcript);

      // Decide generation vs modification
      if (forceModify || gameState === GameState.PLAYING) {
        modifyWorld(transcript); // incremental updates
      } else {
        generateWorld(transcript); // initial world generation
      }
    };

    recognition.start();
  };

  const handleTextSubmit = () => {
    if (!prompt.trim()) return;
    setSubmittedPrompt(prompt);
    generateWorld(prompt); // calls /generate-world
    setPrompt('');
  };

  const handleModifySubmit = () => {
    if (!modifyPrompt.trim()) return;
    console.log("Modifying with text:", modifyPrompt);
    modifyWorld(modifyPrompt);
    setModifyPrompt('');
  };

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative', background: '#000' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute' }} />

    {gameState === GameState.PLAYING && (
      <>
        {/* --- Enemy Stats & Controls --- */}
        <div style={{
          position: 'absolute', top: 20, left: 20, zIndex: 10,
          backgroundColor: 'rgba(0,0,0,0.7)',
          padding: '15px', borderRadius: '8px',
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

        {/* ✅ NEW: Text Input for Modifications */}
        <div style={{
          position: 'fixed', bottom: 30, left: '50%', transform: 'translateX(-50%)',
          zIndex: 20, display: 'flex', gap: '10px', alignItems: 'center'
        }}>
          <input
            type="text"
            value={modifyPrompt}
            onChange={e => setModifyPrompt(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && handleModifySubmit()}
            placeholder="Type command (e.g., 'add 5 trees')..."
            style={{
              padding: '12px 20px',
              fontSize: '14px',
              width: '300px',
              background: 'rgba(0,0,0,0.8)',
              color: '#fff',
              border: '2px solid rgba(255,255,255,0.3)',
              borderRadius: '25px',
              outline: 'none'
            }}
          />
          <button
            onClick={handleModifySubmit}
            style={{
              padding: '12px 24px',
              fontSize: '14px',
              fontWeight: 'bold',
              background: '#4CAF50',
              color: '#fff',
              border: 'none',
              borderRadius: '25px',
              cursor: 'pointer'
            }}
          >
            Modify
          </button>
        </div>

        {/* --- Floating Mic Button --- */}
        <div style={{
          position: 'fixed', bottom: 30, right: 30, zIndex: 20
        }}>
          <button
            onClick={() => startVoiceCapture(true)}
            style={{
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              fontSize: '24px',
              background: isListening ? '#FF5555' : 'rgba(255, 85, 85, 0.6)',
              color: '#fff',
              border: 'none',
              cursor: isListening ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(255,0,0,0.4)',
              transition: 'all 0.2s',
              animation: isListening ? 'pulse 1s infinite' : 'none',
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '1'}
            onMouseLeave={e => e.currentTarget.style.opacity = '0.9'}
          >
            {isListening ? '🎙️' : '🎤'}
          </button>
          <style>{`
            @keyframes pulse {
              0% { transform: scale(1); box-shadow: 0 0 12px rgba(255,0,0,0.4); }
              50% { transform: scale(1.1); box-shadow: 0 0 24px rgba(255,0,0,0.6); }
              100% { transform: scale(1); box-shadow: 0 0 12px rgba(255,0,0,0.4); }
            }
          `}</style>
        </div>
      </>
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