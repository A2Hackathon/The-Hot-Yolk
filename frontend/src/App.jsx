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
  const occupiedCells = new Set(); // store "gridX:gridZ" strings


  const [gameState, setGameState] = useState(GameState.IDLE);
  const [isListening, setIsListening] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [modifyPrompt, setModifyPrompt] = useState('');
  const [submittedPrompt, setSubmittedPrompt] = useState('');
  const [enemyCount, setEnemyCount] = useState(0);

  const buildingGridConfig = {
    gridSizeX: 2,   // buildings per row
    gridSizeZ: 2,   // buildings per column
    cellSize: 30,     // each cell width/height including road spacing
    roadMargin: 6   // gap between buildings for roads
  };

  const buildingGridOrigins = [
    { x: -60, z: -60 },
    { x: 60, z: -60 },
    { x: -60, z: 60 },
    { x: 60, z: 60 },
  ];

  const playerState = useRef({
    velocity: new THREE.Vector3(),
    isGrounded: false,
    canDoubleJump: true,
    isDashing: false,
    dashTime: 0,
    dashCooldown: 0,
  });

  const cameraOffset = useRef({
    distance: 20,
    height: 15,
    angle: 0,
    pitch: 0.3
  });

  const pressedKeys = useRef(new Set());

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Create gradient sky sphere
    const skyGeo = new THREE.SphereGeometry(500, 32, 32);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#1e3a8a'); // Dark blue at top
    gradient.addColorStop(0.5, '#60a5fa'); // Bright blue
    gradient.addColorStop(1, '#e0f2fe'); // Light blue at horizon
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
    const skyTexture = new THREE.CanvasTexture(canvas);
    const skyMat = new THREE.MeshBasicMaterial({ 
      map: skyTexture, 
      side: THREE.BackSide 
    });
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    skyMesh.userData.isSky = true;
    scene.add(skyMesh);

    const planeMaterial = new THREE.MeshStandardMaterial({
      color: 0xA5BDF5,
      roughness: 0.8,
      metalness: 0.1,
    });

    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1000, 1000),
      planeMaterial
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = 0;
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);

    const ambientLight = new THREE.AmbientLight(0xA5BDF5, 0.25);
    scene.add(ambientLight);

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

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    scene.add(camera);

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
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const animate = () => {
      updateEnemyHealthBars();
      animationIdRef.current = requestAnimationFrame(animate);
      const player = playerRef.current;
      const cam = cameraRef.current;
      
      if (player && cam) {
        const camDir = new THREE.Vector3();
        cam.getWorldDirection(camDir);
        camDir.y = 0;
        camDir.normalize();

        const targetYaw = Math.atan2(camDir.x, camDir.z);
        player.rotation.y += ((targetYaw - player.rotation.y + Math.PI) % (2 * Math.PI) - Math.PI) * 0.1;

        const moveSpeed = 0.3;
        const dashSpeed = 1.2;
        const gravity = -0.018;

        if (pressedKeys.current.has('arrowleft')) cameraOffset.current.angle += 0.04;
        if (pressedKeys.current.has('arrowright')) cameraOffset.current.angle -= 0.04;
        if (pressedKeys.current.has('arrowup')) cameraOffset.current.pitch += 0.02;
        if (pressedKeys.current.has('arrowdown')) cameraOffset.current.pitch -= 0.02;

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

          player.position.addScaledVector(moveDir, speed);

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

        const distance = cameraOffset.current.distance;
        const height = cameraOffset.current.height;
        const angle = cameraOffset.current.angle;
        const pitch = cameraOffset.current.pitch;

        const offsetX = -Math.sin(angle) * distance;
        const offsetZ = -Math.cos(angle) * distance;
        const offsetY = height + Math.sin(pitch) * distance;

        const targetPos = new THREE.Vector3(
          player.position.x + offsetX,
          player.position.y + offsetY,
          player.position.z + offsetZ
        );

        cam.position.lerp(targetPos, 0.1);

        const lookAtY = player.position.y + Math.sin(pitch) * 2;
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
      const r = colorMapArray[row][col][0];
      const g = colorMapArray[row][col][1];
      const b = colorMapArray[row][col][2];
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
    const group = new THREE.Group();

    const trunkHeight = 3 * treeData.scale;
    const trunkRadius = 0.4 * treeData.scale;
    const blockHeight = 0.5 * treeData.scale;
    const blockCount = Math.floor(trunkHeight / blockHeight);

    const trunkMaterial = new THREE.MeshStandardMaterial({
      color: 0xab7354,
      roughness: 1.5,
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
      
      // OPTIMIZATION: Disable auto-update for static tree blocks
      block.matrixAutoUpdate = false;
      block.updateMatrix();
      
      group.add(block);
    }

    if (treeData.leafless) {
      const leafCount = 4;
      const leafWidth = 3 * treeData.scale;
      const leafHeight = 1.5 * treeData.scale;

      for (let i = 0; i < leafCount; i++) {
        const w = leafWidth - i * 0.6 * treeData.scale;
        const h = leafHeight;
        const geometry = new THREE.BoxGeometry(w, h, w);
        const colorAttr = [];
        const green = new THREE.Color(0x4BBB6D);
        const white = new THREE.Color(0xffffff);

        for (let v = 0; v < geometry.attributes.position.count; v++) {
          const y = geometry.attributes.position.getY(v);
          const t = (y + h/2) / h;
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
        
        // OPTIMIZATION: Static leaves
        leaf.matrixAutoUpdate = false;
        leaf.updateMatrix();
        
        group.add(leaf);
      }
    } else {
      const leafCount = 5;
      const leafBaseSize = 2.2 * treeData.scale;
      const leafHeight = 1.1 * treeData.scale;

      for (let i = 0; i < leafCount; i++) {
        const size = leafBaseSize - i * 0.35 * treeData.scale;

        // Low-poly blob instead of box
        const geometry = new THREE.IcosahedronGeometry(size, 0);

        const colorAttr = [];
        const lightGreen = new THREE.Color(0x9adf8f);
        const darkGreen = new THREE.Color(0x6fbf7f);

        for (let v = 0; v < geometry.attributes.position.count; v++) {
          const y = geometry.attributes.position.getY(v);

          // Normalize Y for gradient
          const t = (y + size) / (size * 2);

          if (t < 0.55) {
            colorAttr.push(lightGreen.r, lightGreen.g, lightGreen.b);
          } else {
            colorAttr.push(darkGreen.r, darkGreen.g, darkGreen.b);
          }
        }

        geometry.setAttribute(
          'color',
          new THREE.Float32BufferAttribute(colorAttr, 3)
        );

        const material = new THREE.MeshStandardMaterial({
          vertexColors: true,
          flatShading: true,
          roughness: 0.9,
        });

        const leaf = new THREE.Mesh(geometry, material);

        // Stack like reference image
        leaf.position.y = trunkHeight + i * leafHeight + leafHeight * 0.5;
        leaf.position.x = (Math.random() - 0.5) * 0.6 * treeData.scale;
        leaf.position.z = (Math.random() - 0.5) * 0.6 * treeData.scale;

        leaf.castShadow = true;

        // OPTIMIZATION: Static leaves
        leaf.matrixAutoUpdate = false;
        leaf.updateMatrix();

        group.add(leaf);
      }

    }

    group.position.set(treeData.position.x, treeData.position.y, treeData.position.z);
    group.scale.setScalar(treeData.scale);
    group.rotation.y = treeData.rotation || 0;
    
    // OPTIMIZATION: Mark entire tree as static
    group.matrixAutoUpdate = false;
    group.updateMatrix();

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

  const getBuildingGridPosition = (index, gridConfig, gridOrigin) => {
    const { gridSizeX, gridSizeZ, cellSize } = gridConfig;

    const row = Math.floor(index / gridSizeX);
    const col = index % gridSizeX;

    const x = col * cellSize - ((gridSizeX - 1) * cellSize) / 2 + gridOrigin.x;
    const z = row * cellSize - ((gridSizeZ - 1) * cellSize) / 2 + gridOrigin.z;

    return { x, z };
  };

  const getBuildingTypeForBiome = (biomeName, index) => {
    if (biomeName === 'arctic') {
      return 'igloo';
    }

    // Non-arctic: mix skyscrapers + houses
    // Example: every 3rd building is a skyscraper
    return index % 3 === 0 ? 'skyscraper' : 'house';
  };
    
  const createBuilding = (buildingData, idx, type, gridOrigin) => {
    if (!type) {
      console.warn('createBuilding called without type, defaulting to house');
      type = 'house';
    }
    const group = new THREE.Group();
    let mesh;

    // Pastel colors palette
    const pastelColors = [
      0x18e7d7, 
      0x6bcdeb,
      0xFAA869,
      0xC3B1E1, 
      0xFFFACD  
    ];
    const color = pastelColors[Math.floor(Math.random() * pastelColors.length)];

    if (type === "igloo") {
      const radius = (buildingData.width || 4) * 1.5;
      const geometry = new THREE.SphereGeometry(radius, 16, 16, 0, Math.PI);
      const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
      mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = radius / 2; // lift above terrain
      group.add(mesh);

    } else if (type === "skyscraper") {
      console.log("ADDING SKYSCRAPER", buildingData);
      const height = (buildingData.height || 15);
      const width = (buildingData.width || 4) * 2;
      const depth = (buildingData.depth || 4) * 2;

      const baseColor = new THREE.Color(color);
      const lighter = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.35);
      const darker = baseColor.clone().lerp(new THREE.Color(0x000000), 0.25);

      const makeGradientMaterial = (geometry, h) => {
        const colors = [];
        for (let i = 0; i < geometry.attributes.position.count; i++) {
          const y = geometry.attributes.position.getY(i);
          const t = (y + h / 2) / h;
          const c = t < 0.5 ? baseColor : lighter;
          colors.push(c.r, c.g, c.b);
        }
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        return new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.6,
          metalness: 0.2,
          flatShading: true
        });
      };

      /* ---------- BASE PODIUM ---------- */
      const baseHeight = height * 0.12;
      const baseGeom = new THREE.BoxGeometry(width * 1.2, baseHeight, depth * 1.2);
      baseGeom.translate(0, baseHeight / 2, 0);

      const baseMat = makeGradientMaterial(baseGeom, baseHeight);
      const base = new THREE.Mesh(baseGeom, baseMat);
      base.castShadow = true;
      base.receiveShadow = true;
      base.matrixAutoUpdate = false;
      base.updateMatrix();
      group.add(base);

      /* ---------- MAIN SHAFT ---------- */
      const shaftHeight = height * 0.7;
      const shaftGeom = new THREE.BoxGeometry(width, shaftHeight, depth);
      shaftGeom.translate(0, baseHeight + shaftHeight / 2, 0);

      const shaftMat = makeGradientMaterial(shaftGeom, shaftHeight);
      const shaft = new THREE.Mesh(shaftGeom, shaftMat);
      shaft.castShadow = true;
      shaft.receiveShadow = true;
      shaft.matrixAutoUpdate = false;
      shaft.updateMatrix();
      group.add(shaft);

      /* ---------- UPPER TIER ---------- */
      const upperHeight = height * 0.18;
      const upperGeom = new THREE.BoxGeometry(
        width * 0.7,
        upperHeight,
        depth * 0.7
      );
      upperGeom.translate(
        0,
        baseHeight + shaftHeight + upperHeight / 2,
        0
      );

      const upperMat = makeGradientMaterial(upperGeom, upperHeight);
      const upper = new THREE.Mesh(upperGeom, upperMat);
      upper.castShadow = true;
      upper.matrixAutoUpdate = false;
      upper.updateMatrix();
      group.add(upper);

      /* ---------- CROWN ---------- */
      const crownHeight = height * 0.1;
      const crownGeom = new THREE.CylinderGeometry(
        width * 0.15,
        width * 0.35,
        crownHeight,
        6
      );
      crownGeom.translate(
        0,
        baseHeight + shaftHeight + upperHeight + crownHeight / 2,
        0
      );

      const crownColors = [];
      for (let i = 0; i < crownGeom.attributes.position.count; i++) {
        crownColors.push(darker.r, darker.g, darker.b);
      }
      crownGeom.setAttribute(
        'color',
        new THREE.Float32BufferAttribute(crownColors, 3)
      );

      const crown = new THREE.Mesh(
        crownGeom,
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.7,
          metalness: 0.25,
          flatShading: true
        })
      );
      crown.matrixAutoUpdate = false;
      crown.updateMatrix();
      group.add(crown);

      /* ---------- SPIRE ---------- */
      const spireHeight = height * 0.25;
      const spireGeom = new THREE.CylinderGeometry(
        width * 0.05,
        width * 0.05,
        spireHeight,
        6
      );
      spireGeom.translate(
        0,
        baseHeight + shaftHeight + upperHeight + crownHeight + spireHeight / 2,
        0
      );

      const spire = new THREE.Mesh(
        spireGeom,
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.4,
          metalness: 0.6
        })
      );
      spire.matrixAutoUpdate = false;
      spire.updateMatrix();
      group.add(spire);

    } else {
      // Victorian / normal house
      mesh = new THREE.Group();

      const width = (buildingData.width || 4) * 2;
      const depth = (buildingData.depth || 4) * 2;
      const height = (buildingData.height || 6) * 2;

      // Base box
      const baseGeom = new THREE.BoxGeometry(width, height * 0.6, depth);
      baseGeom.translate(0, (height * 0.6) / 2, 0);
      const baseMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.6 });
      const baseMesh = new THREE.Mesh(baseGeom, baseMat);
      mesh.add(baseMesh);

      group.add(mesh);
    }

    // Position on terrain
    const gridPos = getBuildingGridPosition(idx, buildingGridConfig, gridOrigin);
    occupiedCells.add(`${Math.round(gridPos.x)}:${Math.round(gridPos.z)}`);
    const terrainY = getHeightAt(gridPos.x, gridPos.z);
    group.position.set(gridPos.x, terrainY, gridPos.z);

    group.rotation.y = (Math.random() - 0.5) * 0.1;

    group.matrixAutoUpdate = false;
    group.updateMatrix();

    return group;
  };

  const createMountainPeak = (peakData) => {
    const height = 80; 
    const geometry = new THREE.ConeGeometry(40, height, 4);
    const material = new THREE.MeshStandardMaterial({ 
      color: 0xF0F0F0,
      emissive: 0x888888,
      emissiveIntensity: 0.2
    });
    const peak = new THREE.Mesh(geometry, material);
    const terrainY = getHeightAt(peakData.position.x, peakData.position.z)
    const scaledHeight = height * peakData.scale;
    peak.position.set(
      peakData.position.x,
      terrainY +  scaledHeight / 2, // optional offset if you want some lift
      peakData.position.z
    );
    peak.scale.setScalar(peakData.scale);
    peak.rotation.y = Math.random() * Math.PI * 2;
    peak.castShadow = true;
    return peak;
  };
    
  const getHeightAt = (x, z) => {
    if (!heightmapRef.current) return 0;
    const hm = heightmapRef.current;
    const size = hm.length;
    const terrainSize = 256;
    const halfSize = terrainSize / 2;

    const col = Math.floor(((x + halfSize) / terrainSize) * (size - 1));
    const row = Math.floor(((z + halfSize) / terrainSize) * (size - 1));

    const r = Math.max(0, Math.min(size - 1, row));
    const c = Math.max(0, Math.min(size - 1, col));

    return hm[r][c] * 10;
  };

  const createPlayer = (spawn) => {
    const group = new THREE.Group();
    const yOffset = getHeightAt(spawn.x, spawn.z);

    const geometry = new THREE.SphereGeometry(1, 32, 32);
    geometry.scale(1, 1, 1.4);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffdd, roughness: 0.5, metalness: 0.1 });
    const egg = new THREE.Mesh(geometry, material);
    egg.castShadow = true;
    egg.receiveShadow = true;
    egg.rotation.x = Math.PI / 2;
    group.add(egg);

    group.position.set(spawn.x, yOffset + 1, spawn.z);
    return group;
  };

  const createEnemies = (position, id) => {
    const group = new THREE.Group();

    const bodyGeom = new THREE.BoxGeometry(2, 2, 2);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 1;
    body.castShadow = true;
    group.add(body);

    const headGeom = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const head = new THREE.Mesh(headGeom, headMat);
    head.position.set(0, 2.5, 0.2);
    group.add(head);

    const beakGeom = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    const beakMat = new THREE.MeshStandardMaterial({ color: 0xffa500 });
    const beak = new THREE.Mesh(beakGeom, beakMat);
    beak.position.set(0, 2.5, 0.9);
    group.add(beak);

    const combGeom = new THREE.BoxGeometry(0.4, 0.4, 0.2);
    const combMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const comb = new THREE.Mesh(combGeom, combMat);
    comb.position.set(0, 3.1, 0.0);
    group.add(comb);

    const footGeom = new THREE.BoxGeometry(0.3, 0.7, 0.3);
    const footMat = new THREE.MeshStandardMaterial({ color: 0xffa500 });
    const leftFoot = new THREE.Mesh(footGeom, footMat);
    leftFoot.position.set(-0.5, 0.35, 0.3);
    const rightFoot = new THREE.Mesh(footGeom, footMat);
    rightFoot.position.set(0.5, 0.35, 0.3);
    group.add(leftFoot, rightFoot);

    const healthBarBgGeom = new THREE.BoxGeometry(2.5, 0.2, 0.3);
    const healthBarBgMat = new THREE.MeshBasicMaterial({ color: 0x444444 });
    const healthBarBg = new THREE.Mesh(healthBarBgGeom, healthBarBgMat);
    healthBarBg.position.set(0, 3.5, 0);
    group.add(healthBarBg);

    const healthBarGeom = new THREE.BoxGeometry(2.5, 0.2, 0.3);
    const healthBarMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const healthBar = new THREE.Mesh(healthBarGeom, healthBarMat);
    healthBar.position.set(0, 0, 0.01);
    healthBarBg.add(healthBar);

    group.userData = { health: 3, maxHealth: 3, id, healthBar };
    group.position.set(position.x, getHeightAt(position.x, position.z), position.z);

    return group;
  };

  const updateEnemyHealthBars = () => {
    const cam = cameraRef.current;
    if (!cam) return;

    enemiesRef.current.forEach((enemy) => {
      if (!enemy.userData || !enemy.userData.healthBar) return;

      const health = enemy.userData.health;
      const maxHealth = enemy.userData.maxHealth;
      const healthBar = enemy.userData.healthBar;
      const scale = Math.max(0, health / maxHealth);
      healthBar.scale.x = scale;
      healthBar.position.x = -(3 * (1 - scale)) / 2;

      if (scale > 0.5) healthBar.material.color.set(0x00ff00);
      else if (scale > 0.25) healthBar.material.color.set(0xffff00);
      else healthBar.material.color.set(0xff0000);

      healthBar.lookAt(cam.position.x, healthBar.position.y, cam.position.z);
    });
  };

  const createCloud = (x, y, z, scale = 1) => {
    const cloudGroup = new THREE.Group();
    
    // More boxes for fluffier clouds
    const boxCount = 5 + Math.floor(Math.random() * 4); // 5-8 boxes
    
    for (let i = 0; i < boxCount; i++) {
      // More variation in size
      const width = (4 + Math.random() * 6) * scale;
      const height = (2 + Math.random() * 3) * scale;
      const depth = (3 + Math.random() * 5) * scale;

      const geometry = new THREE.BoxGeometry(width, height, depth);
      
      // Slight variation in cloud color for depth
      const brightness = 0.95 + Math.random() * 0.05;
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(brightness, brightness, brightness),
      });

      const box = new THREE.Mesh(geometry, material);
      
      // More spread out positioning for bigger, fluffier clouds
      box.position.set(
        (Math.random() - 0.5) * 15 * scale,
        (Math.random() - 0.5) * 6 * scale,          
        (Math.random() - 0.5) * 10 * scale
      );
      
      box.castShadow = false; // Clouds typically don't cast shadows
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

      if (!data.world) {
        throw new Error('Invalid response: missing world data');
      }

      setCurrentWorld(data);

      const scene = sceneRef.current;
      if (!scene) return;

      const objectsToRemove = [];
      scene.children.forEach((child) => {
        if (!child.isLight && !child.userData?.isSky) objectsToRemove.push(child);
      });
      objectsToRemove.forEach((obj) => scene.remove(obj));
      
      terrainMeshRef.current = null;
      enemiesRef.current = [];
      structuresRef.current = [];
      occupiedCells.clear();

      if (data.world && data.world.lighting_config) {
        console.log('[FRONTEND LIGHTING DEBUG] Applying lighting:', data.world.lighting_config);
        updateLighting(data.world.lighting_config);
      }

      if (data.world && data.world.heightmap_raw && data.world.colour_map_array) {
        heightmapRef.current = data.world.heightmap_raw;
        colorMapRef.current = data.world.colour_map_array;
        terrainPlacementMaskRef.current = heightmapRef.current.map(row =>
          row.map(height => (height >= 0 ? 1 : 0))
        );
        const terrainMesh = createTerrain(heightmapRef.current, colorMapRef.current, 256);
        terrainMeshRef.current = terrainMesh;
        scene.add(terrainMesh);
      }

      if (data.structures) {
        if (data.structures.trees) {
          console.log(`[FRONTEND] Creating ${data.structures.trees.length} trees...`);
          data.structures.trees.forEach((treeData) => {
            // Map tree position to terrain mask indices
            const row = Math.floor((treeData.position.z + 128) / 256 * terrainPlacementMaskRef.current.length);
            const col = Math.floor((treeData.position.x + 128) / 256 * terrainPlacementMaskRef.current.length);

            // Skip this tree if the cell is occupied
            if (terrainPlacementMaskRef.current[row][col] === 0) return;

            const tree = createTree(treeData);
            tree.userData = { structureType: 'tree' };
            scene.add(tree);
            structuresRef.current.push(tree);
          });
          console.log(`✓ Added ${structuresRef.current.filter(obj => obj.userData.structureType === 'tree').length} trees`);
        }

        const cloudCount = 30;
        for (let i = 0; i < cloudCount; i++) {
          const x = (Math.random() - 0.5) * 500;
          const y = 60 + Math.random() * 90;
          const z = (Math.random() - 0.5) * 600;
          const scale = 3 + Math.random() * 2;
          const cloud = createCloud(x, y, z, scale);
          scene.add(cloud);
        }

        if (data.structures.rocks) {
          data.structures.rocks.forEach(rockData => {
            const rock = createRock(rockData);
            rock.userData = { structureType: 'rock' };
            scene.add(rock);
            structuresRef.current.push(rock);
          });
          console.log(`✓ Added ${data.structures.rocks.length} rocks`);
        }
        
        if (data.structures.peaks) {
          data.structures.peaks.forEach(peakData => {
            const peak = createMountainPeak(peakData);
            peak.userData = { structureType: 'peak' };
            scene.add(peak);
            structuresRef.current.push(peak);
          });
          console.log(`✓ Added ${data.structures.peaks.length} mountain peaks`);
        }

          if (data.structures?.buildings) {
            const biomeName = data.world?.biome_name;

            data.structures.buildings.forEach((buildingData, idx) => {
              const gridIndex = Math.floor(
                idx / (buildingGridConfig.gridSizeX * buildingGridConfig.gridSizeZ)
              );
              const localIndex =
                idx % (buildingGridConfig.gridSizeX * buildingGridConfig.gridSizeZ);
              const gridOrigin =
                buildingGridOrigins[gridIndex % buildingGridOrigins.length];

              const buildingType = getBuildingTypeForBiome(biomeName, idx);

              const building = createBuilding(
                buildingData,
                localIndex,
                buildingType,
                gridOrigin
              );

              building.userData = {
                structureType: 'building',
                buildingType,
              };

              scene.add(building);
              structuresRef.current.push(building);
            });

          // Update terrainPlacementMask to mark building locations as occupied
          data.structures.buildings.forEach((buildingData, idx) => {
            const gridIndex = Math.floor(idx / (buildingGridConfig.gridSizeX * buildingGridConfig.gridSizeZ));
            const localIndex = idx % (buildingGridConfig.gridSizeX * buildingGridConfig.gridSizeZ);
            const gridOrigin = buildingGridOrigins[gridIndex % buildingGridOrigins.length];
            const gridPos = getBuildingGridPosition(localIndex, buildingGridConfig, gridOrigin);

            const row = Math.floor((gridPos.z + 128) / 256 * terrainPlacementMaskRef.current.length);
            const col = Math.floor((gridPos.x + 128) / 256 * terrainPlacementMaskRef.current.length);

            terrainPlacementMaskRef.current[row][col] = 0; // mark as occupied
          });

        }
      }

      const spawn = data.spawn_point || { x: 0, z: 0 };
      const playerMesh = createPlayer(spawn);
      playerRef.current = playerMesh;
      scene.add(playerMesh);

      if (data.combat && data.combat.enemies) {
        enemiesRef.current = data.combat.enemies.map((enemyData, idx) => {
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

      // Store old counts
      const oldTreeCount = currentWorld?.structures?.trees?.length || 0;
      const oldRockCount = currentWorld?.structures?.rocks?.length || 0;
      const oldBuildingCount = currentWorld?.structures?.buildings?.length || 0;
      const oldPeakCount = currentWorld?.structures?.peaks?.length || 0;
      const oldEnemyCount = currentWorld?.combat?.enemies?.length || 0;

      console.log("Old counts - Trees:", oldTreeCount, "Rocks:", oldRockCount, "Buildings:", oldBuildingCount, "Peaks:", oldPeakCount, "Enemies:", oldEnemyCount);

      // Get new counts
      const newTreeCount = data.structures?.trees?.length || 0;
      const newRockCount = data.structures?.rocks?.length || 0;
      const newBuildingCount = data.structures?.buildings?.length || 0;
      const newPeakCount = data.structures?.peaks?.length || 0;
      const newEnemyCount = data.combat?.enemies?.length || 0;

      console.log("New counts - Trees:", newTreeCount, "Rocks:", newRockCount, "Buildings:", newBuildingCount, "Peaks:", newPeakCount, "Enemies:", newEnemyCount);

      // Handle REMOVALS (if counts decreased)
      if (newTreeCount < oldTreeCount) {
        const toRemove = oldTreeCount - newTreeCount;
        console.log(`[MODIFY] Removing ${toRemove} trees...`);
        for (let i = 0; i < toRemove; i++) {
          const tree = structuresRef.current.find(obj => obj.userData?.structureType === 'tree');
          if (tree) {
            scene.remove(tree);
            structuresRef.current = structuresRef.current.filter(obj => obj !== tree);
          }
        }
      }

      if (newRockCount < oldRockCount) {
        const toRemove = oldRockCount - newRockCount;
        console.log(`[MODIFY] Removing ${toRemove} rocks...`);
        for (let i = 0; i < toRemove; i++) {
          const rock = structuresRef.current.find(obj => obj.userData?.structureType === 'rock');
          if (rock) {
            scene.remove(rock);
            structuresRef.current = structuresRef.current.filter(obj => obj !== rock);
          }
        }
      }

      if (newBuildingCount < oldBuildingCount) {
        const toRemove = oldBuildingCount - newBuildingCount;
        console.log(`[MODIFY] Removing ${toRemove} buildings...`);
        for (let i = 0; i < toRemove; i++) {
          const building = structuresRef.current.find(obj => obj.userData?.structureType === 'building');
          if (building) {
            scene.remove(building);
            structuresRef.current = structuresRef.current.filter(obj => obj !== building);
          }
        }
      }

      if (newPeakCount < oldPeakCount) {
        const toRemove = oldPeakCount - newPeakCount;
        console.log(`[MODIFY] Removing ${toRemove} peaks...`);
        for (let i = 0; i < toRemove; i++) {
          const peak = structuresRef.current.find(obj => obj.userData?.structureType === 'peak');
          if (peak) {
            scene.remove(peak);
            structuresRef.current = structuresRef.current.filter(obj => obj !== peak);
          }
        }
      }

      if (newEnemyCount < oldEnemyCount) {
        const toRemove = oldEnemyCount - newEnemyCount;
        console.log(`[MODIFY] Removing ${toRemove} enemies...`);
        for (let i = 0; i < toRemove; i++) {
          const enemy = enemiesRef.current.pop();
          if (enemy) scene.remove(enemy);
        }
        setEnemyCount(enemiesRef.current.length);
      }

      // Handle ADDITIONS (if counts increased)
      if (data.structures?.trees && newTreeCount > oldTreeCount) {
        const newTrees = data.structures.trees.slice(oldTreeCount);
        console.log(`[MODIFY] Adding ${newTrees.length} new trees...`);

        newTrees.forEach(treeData => {
          const row = Math.floor((treeData.position.z + 128) / 256 * terrainPlacementMaskRef.current.length);
          const col = Math.floor((treeData.position.x + 128) / 256 * terrainPlacementMaskRef.current.length);

          // Skip if cell occupied
          if (terrainPlacementMaskRef.current[row][col] === 0) return;

          const tree = createTree(treeData);
          tree.userData = { ...tree.userData, structureType: 'tree' };
          scene.add(tree);
          structuresRef.current.push(tree);
        });
      }


      if (data.structures?.rocks && newRockCount > oldRockCount) {
        const newRocks = data.structures.rocks.slice(oldRockCount);
        console.log(`[MODIFY] Adding ${newRocks.length} new rocks...`);
        
        newRocks.forEach(rockData => {
          const rock = createRock(rockData);
          rock.userData = { ...rock.userData, structureType: 'rock' };
          scene.add(rock);
          structuresRef.current.push(rock);
        });
      }

      if (data.structures?.buildings && newBuildingCount > oldBuildingCount) {
        const biomeName = data.world?.biome_name;
        const newBuildings = data.structures.buildings.slice(oldBuildingCount);

        newBuildings.forEach((buildingData, idx) => {
          const globalIndex = oldBuildingCount + idx;

          const gridIndex = Math.floor(
            globalIndex / (buildingGridConfig.gridSizeX * buildingGridConfig.gridSizeZ)
          );
          const localIndex =
            globalIndex % (buildingGridConfig.gridSizeX * buildingGridConfig.gridSizeZ);
          const gridOrigin =
            buildingGridOrigins[gridIndex % buildingGridOrigins.length];

          const buildingType = getBuildingTypeForBiome(biomeName, globalIndex);

          const building = createBuilding(
            buildingData,
            localIndex,
            buildingType,
            gridOrigin
          );

          building.userData = {
            structureType: 'building',
            buildingType,
          };

          scene.add(building);
          structuresRef.current.push(building);
        });
      }

      if (data.structures?.peaks && newPeakCount > oldPeakCount) {
        const newPeaks = data.structures.peaks.slice(oldPeakCount);
        console.log(`[MODIFY] Adding ${newPeaks.length} new peaks...`);
        
        newPeaks.forEach(peakData => {
          const peak = createMountainPeak(peakData);
          peak.userData = { ...peak.userData, structureType: 'peak' };
          scene.add(peak);
          structuresRef.current.push(peak);
        });
      }

      if (data.combat?.enemies && newEnemyCount > oldEnemyCount) {
        const newEnemies = data.combat.enemies.slice(oldEnemyCount);
        console.log(`[MODIFY] Adding ${newEnemies.length} new enemies...`);
        
        newEnemies.forEach((enemyData, idx) => {
          if (!enemyData.position) enemyData.position = { x: 0, z: 0 };
          const enemy = createEnemies(enemyData.position, oldEnemyCount + idx);
          scene.add(enemy);
          enemiesRef.current.push(enemy);
        });
        setEnemyCount(enemiesRef.current.length);
      }

      if (data.world?.lighting_config) {
        console.log('[MODIFY] Updating lighting...');
        updateLighting(data.world.lighting_config);
      }

      if (data.physics) {
        console.log('[MODIFY] Updating physics...');
        playerState.current = { ...playerState.current, ...data.physics };
      }

      setCurrentWorld(data);
      
      setGameState(GameState.PLAYING);
      console.log("✓ Modification complete, returned to PLAYING state");
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
        
    // Update gradient sky sphere with time-of-day aware gradients
    const skyMesh = scene.children.find(c => c.userData?.isSky);
    if (skyMesh) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const context = canvas.getContext('2d');
      
      // Create radial gradient from center (horizon) to edge (top of sky)
      const gradient = context.createRadialGradient(256, 256, 0, 256, 256, 256);
      
      // Parse the background color
      const bgColor = new THREE.Color(lightingConfig.background);
      
      // Get HSL values
      const hsl = {};
      bgColor.getHSL(hsl);
      
      // Determine time of day based on lightness and adjust gradient accordingly
      let horizonColor, middleColor, topColor;
      
      if (hsl.l < 0.3) {
        // NIGHT - Dark sky, subtle gradient
        horizonColor = new THREE.Color().setHSL(hsl.h, hsl.s, Math.min(0.4, hsl.l * 1.3));
        middleColor = bgColor.clone();
        topColor = new THREE.Color().setHSL(hsl.h, hsl.s, Math.max(0.05, hsl.l * 0.7));
        
      } else if (hsl.l > 0.6) {
        // NOON/DAY - Bright sky, strong gradient from light horizon to darker top
        horizonColor = new THREE.Color().setHSL(hsl.h, hsl.s, Math.min(0.95, hsl.l * 1.2));
        middleColor = bgColor.clone();
        topColor = new THREE.Color().setHSL(hsl.h, hsl.s, Math.max(0.3, hsl.l * 0.6));
        
      } else {
        // SUNSET/SUNRISE - Medium lightness, keep colors rich and saturated
        horizonColor = new THREE.Color().setHSL(hsl.h, hsl.s, Math.min(0.6, hsl.l * 1.1));
        middleColor = bgColor.clone();
        topColor = new THREE.Color().setHSL(hsl.h, hsl.s, Math.max(0.1, hsl.l * 0.4));
      }
      
      gradient.addColorStop(0, `#${horizonColor.getHexString()}`);
      gradient.addColorStop(0.5, `#${middleColor.getHexString()}`);
      gradient.addColorStop(1, `#${topColor.getHexString()}`);
      
      context.fillStyle = gradient;
      context.fillRect(0, 0, 512, 512);
      
      const skyTexture = new THREE.CanvasTexture(canvas);
      skyMesh.material.map = skyTexture;
      skyMesh.material.needsUpdate = true;
      
      console.log(`[FRONTEND LIGHTING] Background gradient: ${lightingConfig.background}`);
      console.log(`  Time: ${hsl.l < 0.3 ? 'NIGHT' : hsl.l > 0.6 ? 'DAY' : 'SUNSET/SUNRISE'}`);
      console.log(`  Horizon: #${horizonColor.getHexString()}, Middle: #${middleColor.getHexString()}, Top: #${topColor.getHexString()}`);
    }
  };
  const startVoiceCapture = (forceModify = false) => {
    if (!('webkitSpeechRecognition' in window)) {
      return alert('Speech recognition not supported. Use Chrome or Edge.');
    }

    const recognition = new window.webkitSpeechRecognition();
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

      if (forceModify || gameState === GameState.PLAYING) {
        modifyWorld(transcript);
      } else {
        generateWorld(transcript);
      }
    };

    recognition.start();
  };

  const handleTextSubmit = () => {
    if (!prompt.trim()) return;
    setSubmittedPrompt(prompt);
    generateWorld(prompt);
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
          position: 'absolute',
          inset: 0,
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(0,0,0,0.92)',
          color: '#fff',
          fontFamily: 'monospace'
        }}>

          {/* Text */}
          <div style={{
            fontSize: '32px',
            marginBottom: '30px',
            letterSpacing: '1px'
          }}>
            Cooking up <span style={{ color: '#4fa3ff' }}>YOUR</span> world…
          </div>

          {/* Animation */}
          <div className="pan-container">

            <div className="egg" />
            <div className="pan" />
          </div>

          <style>{`
            .pan-container {
              position: relative;
              width: 200px;
              height: 140px;
            }

            .pan {
              position: absolute;
              bottom: 0;
              left: 50%;
              width: 140px;
              height: 30px;
              background: #222;
              border-radius: 0 0 20px 20px;
              transform: translateX(-50%);
            }

            .pan::after {
              content: '';
              position: absolute;
              right: -50px;
              top: 6px;
              width: 60px;
              height: 10px;
              background: #5a3a1a;
              border-radius: 10px;
            }

            .egg {
              position: absolute;
              bottom: 25px;
              left: 50%;
              width: 60px;
              height: 40px;
              background: #fff;
              border-radius: 50%;
              transform: translateX(-50%);
              animation: eggFlip 1s ease-in-out infinite;
            }

            .egg::after {
              content: '';
              position: absolute;
              top: 10px;
              left: 20px;
              width: 18px;
              height: 18px;
              background: orange;
              border-radius: 50%;
            }

            @keyframes eggFlip {
              0% {
                transform: translate(-50%, 0) rotate(0deg);
              }
              50% {
                transform: translate(-50%, -50px) rotate(180deg);
              }
              100% {
                transform: translate(-50%, 0) rotate(360deg);
              }
            }
          `}</style>
        </div>
      )}
    </div>
  );
};

export default VoiceWorldBuilder;