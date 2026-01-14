﻿import * as THREE from 'three';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import GameSettingsPanel from './GameSettingsPanel';


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
  const reflectorRef = useRef(null);


  const [gameState, setGameState] = useState(GameState.IDLE);
  const [isListening, setIsListening] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [modifyPrompt, setModifyPrompt] = useState('');
  const [submittedPrompt, setSubmittedPrompt] = useState('');
  const [enemyCount, setEnemyCount] = useState(0);
  const [chatHistory, setChatHistory] = useState([]);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [uploadedImage, setUploadedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [physicsSettings, setPhysicsSettings] = useState({
  speed: 5.0,
  gravity: 20.0,
  jumpHeight: 3.0
});
  const buildingGridConfig = {
    gridSizeX: 2,   // buildings per row
    gridSizeZ: 2,   // buildings per column
    cellSize: 50,     // each cell width/height including road spacing (increased from 30 for more spread)
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

  const createGround = (scene, biomeName) => {
    // Remove existing ground if any
    const oldGroundObjects = scene.children.filter(c => c.userData?.isGround);
    oldGroundObjects.forEach(obj => scene.remove(obj));

    // Normal ground for all biomes
      const material = new THREE.MeshStandardMaterial({
        color: 0xA5BDF5,
        roughness: 0.7,
        metalness: 0.05,
      });

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(1000, 1000),
        material
      );

      ground.rotation.x = -Math.PI / 2;
      ground.position.y = 0;
      ground.receiveShadow = true;
      ground.userData.isGround = true;

      scene.add(ground);
  };

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

    const groundGeometry = new THREE.PlaneGeometry(1000, 1000);

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

    const renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
  
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
          const jumpVelocity = physicsSettings.jumpHeight * 0.133;
          playerState.current.velocity.y = jumpVelocity;
          playerState.current.isGrounded = false;
        } else if (playerState.current.canDoubleJump) {
          const jumpVelocity = physicsSettings.jumpHeight * 0.133;
          playerState.current.velocity.y = jumpVelocity;
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

        const moveSpeed = physicsSettings.speed * 0.06;
        const dashSpeed = moveSpeed * 4;
        const gravity = -(physicsSettings.gravity * 0.0009);

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

          // Check collision before moving
          const newX = player.position.x + moveDir.x * speed;
          const newZ = player.position.z + moveDir.z * speed;
          const playerRadius = 1.5; // Player collision radius
          
          let canMove = true;
          
          // Check collision with structures
          for (const structure of structuresRef.current) {
            if (!structure.userData?.structureType) continue;
            
            const structPos = structure.position;
            let structRadius = 0;
            let structHeight = 0;
            
            if (structure.userData.structureType === 'building') {
              structRadius = structure.userData.collisionRadius || 5;
              structHeight = structure.userData.buildingHeight || 0;
            } else if (structure.userData.structureType === 'tree') {
              // Tree radius based on leaf size
              const scale = structure.userData.scale || 1.0;
              const leafSize = structure.userData.leafless ? 3 * scale : 2.2 * scale;
              structRadius = leafSize + 1;
            } else if (structure.userData.structureType === 'rock') {
              structRadius = (structure.userData.scale || 1.0) * 2;
            }
            
            if (structRadius > 0) {
              const dist = Math.sqrt((newX - structPos.x) ** 2 + (newZ - structPos.z) ** 2);
              const buildingTop = structPos.y + structHeight;
              const playerBottom = player.position.y - 1; // Player is roughly 1 unit radius
              
              // Only block movement if player is at or below building height (not on top)
              if (dist < playerRadius + structRadius && playerBottom <= buildingTop + 0.5) {
                canMove = false;
                break;
              }
            }
          }
          
          if (canMove) {
          player.position.addScaledVector(moveDir, speed);
          }

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
          // Check terrain height first
          const terrainY = getHeightAt(player.position.x, player.position.z) + 2;
          let groundY = terrainY;
          let isOnBuilding = false;
          
          // Check if player is on top of a building
          for (const structure of structuresRef.current) {
            if (structure.userData?.structureType === 'building') {
              const structPos = structure.position;
              const structHeight = structure.userData.buildingHeight || 0;
              const structRadius = structure.userData.collisionRadius || 5;
              
              const dist = Math.sqrt((player.position.x - structPos.x) ** 2 + (player.position.z - structPos.z) ** 2);
              
              // If player is within building bounds horizontally
              if (dist < structRadius) {
                const buildingTop = structPos.y + structHeight + 2; // +2 for player radius
                // Use building top if it's higher than current ground
                if (buildingTop > groundY) {
                  groundY = buildingTop;
                  isOnBuilding = true;
                }
              }
            }
          }
          
          if (newY < groundY) {
            newY = groundY;
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

  // Helper function to check if a radius around a position is clear
  const checkRadiusClear = (x, z, radius, mask) => {
    const terrainSize = 256;
    const maskSize = mask.length;
    const radiusInCells = Math.ceil((radius / terrainSize) * maskSize);
    
    const centerRow = Math.floor((z + 128) / 256 * maskSize);
    const centerCol = Math.floor((x + 128) / 256 * maskSize);
    
    // Check all cells within radius
    for (let dr = -radiusInCells; dr <= radiusInCells; dr++) {
      for (let dc = -radiusInCells; dc <= radiusInCells; dc++) {
        const row = centerRow + dr;
        const col = centerCol + dc;
        
        // Check bounds
        if (row < 0 || row >= maskSize || col < 0 || col >= maskSize) continue;
        
        // Check distance
        const dist = Math.sqrt(dr * dr + dc * dc);
        if (dist <= radiusInCells) {
          if (mask[row][col] === 0) {
            return false; // Cell is occupied
          }
        }
      }
    }
    return true; // All cells in radius are clear
  };

  // Helper function to mark a radius around a position as occupied
  const markRadiusOccupied = (x, z, radius, mask) => {
    const terrainSize = 256;
    const maskSize = mask.length;
    const radiusInCells = Math.ceil((radius / terrainSize) * maskSize);
    
    const centerRow = Math.floor((z + 128) / 256 * maskSize);
    const centerCol = Math.floor((x + 128) / 256 * maskSize);
    
    // Mark all cells within radius
    for (let dr = -radiusInCells; dr <= radiusInCells; dr++) {
      for (let dc = -radiusInCells; dc <= radiusInCells; dc++) {
        const row = centerRow + dr;
        const col = centerCol + dc;
        
        // Check bounds
        if (row < 0 || row >= maskSize || col < 0 || col >= maskSize) continue;
        
        // Check distance
        const dist = Math.sqrt(dr * dr + dc * dc);
        if (dist <= radiusInCells) {
          mask[row][col] = 0; // Mark as occupied
        }
      }
    }
  };

  const createTree = (treeData) => {
    const group = new THREE.Group();

    const trunkHeight = 3 * treeData.scale;
    const trunkRadius = 0.4 * treeData.scale;
    const blockHeight = 0.5 * treeData.scale;
    const blockCount = Math.floor(trunkHeight / blockHeight);

    // Use custom trunk color if provided, otherwise default
    const trunkColor = treeData.trunk_color ? 
      (typeof treeData.trunk_color === 'string' ? parseInt(treeData.trunk_color.replace('#', ''), 16) : treeData.trunk_color) 
      : 0xab7354;

    const trunkMaterial = new THREE.MeshStandardMaterial({
      color: trunkColor,
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
        // Use custom leaf color if provided, otherwise default
        const leafColorValue = treeData.leaf_color ? 
          (typeof treeData.leaf_color === 'string' ? parseInt(treeData.leaf_color.replace('#', ''), 16) : treeData.leaf_color) 
          : 0x4BBB6D;
        const green = new THREE.Color(leafColorValue);
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
        // Use custom leaf color if provided, otherwise default
        const leafColorValue = treeData.leaf_color ? 
          (typeof treeData.leaf_color === 'string' ? parseInt(treeData.leaf_color.replace('#', ''), 16) : treeData.leaf_color) 
          : 0x9adf8f;
        // Create light and dark variants for gradient
        const baseColor = new THREE.Color(leafColorValue);
        // Clamp RGB values manually (Three.js Color doesn't have clamp method)
        const clamp = (val) => Math.max(0, Math.min(1, val));
        const lightGreen = new THREE.Color(
          clamp(baseColor.r * 1.2),
          clamp(baseColor.g * 1.2),
          clamp(baseColor.b * 1.2)
        );
        const darkGreen = new THREE.Color(
          clamp(baseColor.r * 0.7),
          clamp(baseColor.g * 0.7),
          clamp(baseColor.b * 0.7)
        );

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

    // Calculate terrain height at tree position (ignore y from data if it's 0)
    const terrainY = getHeightAt(treeData.position.x, treeData.position.z);
    const finalY = treeData.position.y !== 0 ? treeData.position.y : terrainY;
    
    group.position.set(treeData.position.x, finalY, treeData.position.z);
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
    // Calculate terrain height at rock position (ignore y from data if it's 0)
    const terrainY = getHeightAt(rockData.position.x, rockData.position.z);
    const finalY = rockData.position.y !== 0 ? rockData.position.y + 0.5 : terrainY + 0.5;
    rock.position.set(rockData.position.x, finalY, rockData.position.z);
    rock.scale.setScalar(rockData.scale);
    rock.rotation.set(
      Math.random() * Math.PI,
      rockData.rotation,
      Math.random() * Math.PI
    );
    rock.castShadow = true;
    return rock;
  };

  const createStreetLamp = (lampData, isNight = false) => {
    const group = new THREE.Group();
    const scale = lampData.scale || 1.0;
    const baseScale = 2.5; // Make lamps bigger
    
    // Base (bottom section - ornate block)
    const baseHeight = 0.8 * baseScale;
    const baseWidth = 0.6 * baseScale;
    const baseGeometry = new THREE.BoxGeometry(baseWidth, baseHeight, baseWidth);
    const baseMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x2a2a2a,  // Dark brown/bronze
      roughness: 0.8,
      metalness: 0.2
    });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.position.y = baseHeight / 2;
    base.castShadow = true;
    group.add(base);
    
    // Base decorative rings
    const ringHeight = 0.15 * baseScale;
    const ringRadius = 0.35 * baseScale;
    for (let i = 0; i < 2; i++) {
      const ringGeometry = new THREE.CylinderGeometry(ringRadius, ringRadius, ringHeight, 16);
      const ring = new THREE.Mesh(ringGeometry, baseMaterial);
      ring.position.y = baseHeight + i * ringHeight * 1.2;
      ring.castShadow = true;
      group.add(ring);
    }
    
    // Shaft (main pole with decorative section)
    const shaftHeight = 5 * baseScale;
    const shaftRadius = 0.12 * baseScale;
    const shaftStartY = baseHeight + 0.3 * baseScale;
    
    // Lower smooth section
    const lowerShaftHeight = shaftHeight * 0.4;
    const lowerShaftGeometry = new THREE.CylinderGeometry(shaftRadius, shaftRadius * 1.2, lowerShaftHeight, 16);
    const lowerShaft = new THREE.Mesh(lowerShaftGeometry, baseMaterial);
    lowerShaft.position.y = shaftStartY + lowerShaftHeight / 2;
    lowerShaft.castShadow = true;
    group.add(lowerShaft);
    
    // Middle decorative section (textured pattern)
    const middleShaftHeight = shaftHeight * 0.35;
    const middleShaftGeometry = new THREE.CylinderGeometry(shaftRadius, shaftRadius, middleShaftHeight, 16);
    const middleShaft = new THREE.Mesh(middleShaftGeometry, baseMaterial);
    middleShaft.position.y = shaftStartY + lowerShaftHeight + middleShaftHeight / 2;
    middleShaft.castShadow = true;
    group.add(middleShaft);
    
    // Upper smooth section
    const upperShaftHeight = shaftHeight * 0.25;
    const upperShaftGeometry = new THREE.CylinderGeometry(shaftRadius * 0.9, shaftRadius, upperShaftHeight, 16);
    const upperShaft = new THREE.Mesh(upperShaftGeometry, baseMaterial);
    upperShaft.position.y = shaftStartY + lowerShaftHeight + middleShaftHeight + upperShaftHeight / 2;
    upperShaft.castShadow = true;
    group.add(upperShaft);
    
    // Lantern roof (pyramidal dome - copper/bronze color)
    const roofHeight = 0.4 * baseScale;
    const roofRadius = 0.5 * baseScale;
    const roofGeometry = new THREE.ConeGeometry(roofRadius, roofHeight, 8);
    const roofMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x8B4513,  // Bronze/copper color
      roughness: 0.7,
      metalness: 0.4
    });
    const roof = new THREE.Mesh(roofGeometry, roofMaterial);
    roof.position.y = shaftStartY + shaftHeight + roofHeight / 2;
    roof.castShadow = true;
    group.add(roof);
    
    // Finial (small decorative top)
    const finialGeometry = new THREE.SphereGeometry(0.08 * baseScale, 8, 8);
    const finial = new THREE.Mesh(finialGeometry, roofMaterial);
    finial.position.y = shaftStartY + shaftHeight + roofHeight;
    finial.castShadow = true;
    group.add(finial);
    
    // Lantern (four-sided glass box)
    const lanternSize = 0.5 * baseScale;
    const lanternHeight = 0.6 * baseScale;
    const lanternGeometry = new THREE.BoxGeometry(lanternSize, lanternHeight, lanternSize);
    
    // Glass material
    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.3,
      roughness: 0.1,
      metalness: 0.0,
      transmission: 0.9
    });
    const lantern = new THREE.Mesh(lanternGeometry, glassMaterial);
    lantern.position.y = shaftStartY + shaftHeight - lanternHeight / 2;
    lantern.castShadow = true;
    group.add(lantern);
    
    // Lantern frame (metal supports)
    const frameMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x444444, 
      roughness: 0.6,
      metalness: 0.4
    });
    const frameThickness = 0.03 * baseScale;
    // Vertical frames
    for (let i = -1; i <= 1; i += 2) {
      for (let j = -1; j <= 1; j += 2) {
        const frameGeom = new THREE.BoxGeometry(frameThickness, lanternHeight, frameThickness);
        const frame = new THREE.Mesh(frameGeom, frameMaterial);
        frame.position.set(i * (lanternSize / 2 - frameThickness / 2), shaftStartY + shaftHeight - lanternHeight / 2, j * (lanternSize / 2 - frameThickness / 2));
        group.add(frame);
      }
    }
    
    // Light bulb inside lantern - only glow at night
    const bulbRadius = 0.15 * baseScale;
    const bulbGeometry = new THREE.SphereGeometry(bulbRadius, 12, 12);
    const bulbMaterial = new THREE.MeshStandardMaterial({ 
      color: isNight ? 0xFFFFAA : 0x666666,
      emissive: isNight ? 0xFFFF88 : 0x000000,
      emissiveIntensity: isNight ? 0.9 : 0
    });
    const bulb = new THREE.Mesh(bulbGeometry, bulbMaterial);
    bulb.position.y = shaftStartY + shaftHeight - lanternHeight / 2;
    group.add(bulb);
    
    // Point light for illumination - only at night
    if (isNight) {
      const light = new THREE.PointLight(0xFFFFAA, 0.6, 12);
      light.position.set(0, shaftStartY + shaftHeight - lanternHeight / 2, 0);
      light.castShadow = false;
      group.add(light);
    }
    
    // Position on terrain
    const terrainY = getHeightAt(lampData.position.x, lampData.position.z);
    group.position.set(lampData.position.x, terrainY, lampData.position.z);
    group.rotation.y = lampData.rotation || 0;
    group.scale.setScalar(scale);
    
    group.matrixAutoUpdate = false;
    group.updateMatrix();
    
    return group;
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

    // For city biome, only houses go in the grid
    // Skyscrapers are placed randomly separately
    return 'house';
  };

  // Helper function to add many small glowing windows to a building face
  // centered: if true, windows are centered around y=0; if false, windows start from y=0
  // doorInfo: { width, height, x, y } to skip windows in door area (optional)
  const addWindowsToFace = (parent, face, width, height, depth, isNight = false, centered = false, doorInfo = null) => {
    const windows = [];
    const windowSize = Math.min(width, depth) * 0.12; // Slightly larger windows
    // Increased spacing to reduce total number of windows for performance
    const spacing = Math.min(width, depth) * 0.5; // Even larger spacing
    
    // Calculate grid of windows - significantly reduced for performance
    const maxCols = Math.min(5, Math.floor(width / spacing)); // Max 5 columns (reduced from 8)
    const maxRows = Math.min(6, Math.floor(height / spacing)); // Max 6 rows (reduced from 12)
    
    // Warm colors for window lights (red, orange, yellow)
    const windowColors = [0xFF4444, 0xFF8844, 0xFFAA44, 0xFFFF44, 0xFFAA88];
    
    // Use a seed based on building position for consistent window patterns
    const seed = Math.floor((parent.position?.x || 0) * 100 + (parent.position?.z || 0) * 100);
    
    for (let row = 0; row < maxRows; row++) {
      for (let col = 0; col < maxCols; col++) {
        // Create all windows in a grid, but only some glow at night
        // Use deterministic randomness based on row/col for consistent pattern
        const randomSeed = (seed + row * 1000 + col * 100) % 100;
        const shouldGlow = isNight ? randomSeed < 60 : randomSeed < 10; // 60% at night, 10% during day
        
        const windowColor = windowColors[(row + col + seed) % windowColors.length];
        
        // Calculate position in regular grid
        const windowX = (col - (maxCols - 1) / 2) * spacing;
        // Position windows: centered around 0 or starting from base
        let windowY;
        if (centered) {
          // For skyscrapers: center windows around y=0
          const minY = -height * 0.4;
          const maxY = height * 0.4;
          windowY = minY + (row / (maxRows - 1 || 1)) * (maxY - minY);
        } else {
          // For houses: windows start above the door
          // Door height is height * 0.25, so windows start above that
          const minY = height * 0.3; // Start above door (door top is at height * 0.25)
          const maxY = height * 0.9;
          windowY = minY + (row / (maxRows - 1 || 1)) * (maxY - minY);
        }
        
        // Skip window if it overlaps with door area (only for front face)
        if (doorInfo && face === 'front') {
          const doorLeft = doorInfo.x - doorInfo.width / 2;
          const doorRight = doorInfo.x + doorInfo.width / 2;
          const doorBottom = doorInfo.y - doorInfo.height / 2;
          const doorTop = doorInfo.y + doorInfo.height / 2;
          
          // Check if window overlaps with door area (with some margin)
          const windowMargin = windowSize / 2;
          if (windowX + windowMargin > doorLeft && 
              windowX - windowMargin < doorRight &&
              windowY + windowMargin > doorBottom && 
              windowY - windowMargin < doorTop) {
            continue; // Skip this window
          }
        }
        
        // Window glass with emissive glow (all windows exist, but only some glow)
        const windowGeom = new THREE.BoxGeometry(windowSize, windowSize, 0.05);
        // Use cheaper materials for performance: MeshBasicMaterial for non-glowing, MeshStandardMaterial only for glowing
        const windowMat = shouldGlow 
          ? new THREE.MeshStandardMaterial({
              color: windowColor,
              emissive: windowColor,
              emissiveIntensity: 0.8,
              roughness: 0.2,
              metalness: 0.1
            })
          : new THREE.MeshBasicMaterial({
              color: 0x222222
            });
        const window = new THREE.Mesh(windowGeom, windowMat);
        // Disable shadows on windows for performance (they're too small to matter)
        window.castShadow = false;
        window.receiveShadow = false;
        
        // Position based on face
        if (face === 'front') {
          window.position.set(windowX, windowY, depth / 2 + 0.05);
        } else if (face === 'back') {
          window.position.set(windowX, windowY, -depth / 2 - 0.05);
        } else if (face === 'left') {
          window.position.set(-width / 2 - 0.05, windowY, windowX);
        } else if (face === 'right') {
          window.position.set(width / 2 + 0.05, windowY, windowX);
        }
        
        parent.add(window);
        windows.push({ mesh: window, color: windowColor });
      }
    }
    
    return windows;
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

      // Determine if it's night for window lighting
      const timeOfDay = currentWorld?.world?.time || 'noon';
      const isNight = timeOfDay === 'night' || timeOfDay === 'midnight' || timeOfDay === 'evening';
      let isNightFromLighting = false;
      if (currentWorld?.world?.lighting_config?.background) {
        const bgColor = new THREE.Color(currentWorld.world.lighting_config.background);
        const hsl = {};
        bgColor.getHSL(hsl);
        isNightFromLighting = hsl.l < 0.3;
      }
      const shouldGlow = isNight || isNightFromLighting;

      // Add many small glowing windows to the main shaft (all 4 faces)
      const allWindows = [];
      const shaftYOffset = baseHeight + shaftHeight / 2;
      const shaftWindowGroup = new THREE.Group();
      shaftWindowGroup.position.y = shaftYOffset;
      
      // Windows are centered around the group origin (y=0)
      const frontWindows = addWindowsToFace(shaftWindowGroup, 'front', width, shaftHeight, depth, shouldGlow, true);
      const backWindows = addWindowsToFace(shaftWindowGroup, 'back', width, shaftHeight, depth, shouldGlow, true);
      const leftWindows = addWindowsToFace(shaftWindowGroup, 'left', width, shaftHeight, depth, shouldGlow, true);
      const rightWindows = addWindowsToFace(shaftWindowGroup, 'right', width, shaftHeight, depth, shouldGlow, true);
      allWindows.push(...frontWindows, ...backWindows, ...leftWindows, ...rightWindows);
      
      group.add(shaftWindowGroup);

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

      // Add windows to upper tier as well
      const upperYOffset = baseHeight + shaftHeight + upperHeight / 2;
      const upperWindowGroup = new THREE.Group();
      upperWindowGroup.position.y = upperYOffset;
      
      // Windows are centered around the group origin (y=0)
      const upperFrontWindows = addWindowsToFace(upperWindowGroup, 'front', width * 0.7, upperHeight, depth * 0.7, shouldGlow, true);
      const upperBackWindows = addWindowsToFace(upperWindowGroup, 'back', width * 0.7, upperHeight, depth * 0.7, shouldGlow, true);
      const upperLeftWindows = addWindowsToFace(upperWindowGroup, 'left', width * 0.7, upperHeight, depth * 0.7, shouldGlow, true);
      const upperRightWindows = addWindowsToFace(upperWindowGroup, 'right', width * 0.7, upperHeight, depth * 0.7, shouldGlow, true);
      allWindows.push(...upperFrontWindows, ...upperBackWindows, ...upperLeftWindows, ...upperRightWindows);
      
      group.add(upperWindowGroup);
      
      // Store windows in userData for lighting updates
      group.userData.windows = allWindows;

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
            // ðŸ  COLORFUL DETAILED HOUSE
      mesh = new THREE.Group();

      const width = (buildingData.width || 4) * 2;
      const depth = (buildingData.depth || 4) * 2;
      const height = (buildingData.height || 6) * 2;

      // Summery bright palette for houses
      const houseColors = [
        0xFF6B6B,  // Coral Pink - warm sunset
        0x4ECDC4,  // Turquoise - ocean breeze
        0x95E1D3,  // Mint Green - fresh
        0xF38181,  // Salmon Pink - warm
        0xAAE3E2,  // Sky Blue - clear sky
        0xFFB84D,  // Peach - tropical
        0xB8E6B8,  // Light Green - fresh grass
        0xFFB3BA,  // Soft Pink - gentle
        0xBAE1FF,  // Light Blue - sky
        0xC7CEEA   // Lavender Blue - soft
      ];
      const mainColor = houseColors[Math.floor(Math.random() * houseColors.length)];
      
      // Main building body (full height, no roof)
      const bodyGeom = new THREE.BoxGeometry(width, height, depth);
      bodyGeom.translate(0, height / 2, 0);
      const bodyMat = new THREE.MeshLambertMaterial({ 
        color: mainColor,
        flatShading: true
      });
      const body = new THREE.Mesh(bodyGeom, bodyMat);
      body.castShadow = true;
      body.receiveShadow = true;
      mesh.add(body);

      // Determine if it's night for window lighting
      const timeOfDay = currentWorld?.world?.time || 'noon';
      const isNight = timeOfDay === 'night' || timeOfDay === 'midnight' || timeOfDay === 'evening';
      let isNightFromLighting = false;
      if (currentWorld?.world?.lighting_config?.background) {
        const bgColor = new THREE.Color(currentWorld.world.lighting_config.background);
        const hsl = {};
        bgColor.getHSL(hsl);
        isNightFromLighting = hsl.l < 0.3;
      }
      const shouldGlow = isNight || isNightFromLighting;
      
      // Door dimensions (needed before adding windows to skip door area)
      const doorWidth = width * 0.25;
      const doorHeight = height * 0.25;
      const doorX = 0; // Door is centered
      const doorY = doorHeight / 2; // Door bottom is at y=0, center is at doorHeight/2
      
      // Door info to pass to window function
      const doorInfo = {
        width: doorWidth,
        height: doorHeight,
        x: doorX,
        y: doorY
      };
      
      // Add many small glowing windows to front and back faces only (for performance)
      const allWindows = [];
      const frontWindows = addWindowsToFace(mesh, 'front', width, height, depth, shouldGlow, false, doorInfo);
      const backWindows = addWindowsToFace(mesh, 'back', width, height, depth, shouldGlow);
      // Only add windows to front and back for houses to reduce performance impact
      allWindows.push(...frontWindows, ...backWindows);
      
      // Store windows in userData for lighting updates
      group.userData.windows = allWindows;

      // Door
      const doorMat = new THREE.MeshBasicMaterial({ color: 0x654321 });  // Dark brown
      const doorGeom = new THREE.BoxGeometry(doorWidth, doorHeight, 0.1);
      const door = new THREE.Mesh(doorGeom, doorMat);
      door.position.set(0, doorHeight / 2, depth / 2 + 0.05);
      mesh.add(door);

      // Door frame
      const windowFrameMat = new THREE.MeshBasicMaterial({ color: 0xd4702b }); // Brown frame color
      const doorFrameGeom = new THREE.BoxGeometry(doorWidth * 1.2, doorHeight * 1.1, 0.12);
      const doorFrame = new THREE.Mesh(doorFrameGeom, windowFrameMat);
      doorFrame.position.set(0, doorHeight / 2, depth / 2 + 0.04);
      mesh.add(doorFrame);

      // Chimney
      const chimneyGeom = new THREE.BoxGeometry(width * 0.15, height * 0.25, width * 0.15);
      const chimneyMat = new THREE.MeshBasicMaterial({ color: 0x8B4513 });
      const chimney = new THREE.Mesh(chimneyGeom, chimneyMat);
      chimney.position.set(width * 0.3, height * 0.9, 0);
      chimney.castShadow = true;
      mesh.add(chimney);

      group.add(mesh);
    }
    
    // Position on terrain
    // If gridOrigin is provided, use grid positioning; otherwise use buildingData.position
    if (gridOrigin !== null && gridOrigin !== undefined) {
    const gridPos = getBuildingGridPosition(idx, buildingGridConfig, gridOrigin);
    occupiedCells.add(`${Math.round(gridPos.x)}:${Math.round(gridPos.z)}`);
    const terrainY = getHeightAt(gridPos.x, gridPos.z);
    group.position.set(gridPos.x, terrainY, gridPos.z);
    } else {
      // Use position from buildingData (for random placement)
      const pos = buildingData.position || { x: 0, y: 0, z: 0 };
      const terrainY = getHeightAt(pos.x, pos.z);
      group.position.set(pos.x, terrainY, pos.z);
      if (type === 'skyscraper') {
        console.log(`[SKYSCRAPERS] Positioning skyscraper at (${pos.x.toFixed(1)}, ${terrainY.toFixed(1)}, ${pos.z.toFixed(1)})`);
      }
    }

    group.rotation.y = (Math.random() - 0.5) * 0.1;

    // Store building dimensions and position for collision detection
    if (type === 'house') {
      const width = (buildingData.width || 4) * 2;
      const depth = (buildingData.depth || 4) * 2;
      const height = (buildingData.height || 6) * 2;
      group.userData.collisionRadius = Math.max(width, depth) / 2 + 2; // Add margin
      group.userData.buildingWidth = width;
      group.userData.buildingDepth = depth;
      group.userData.buildingHeight = height;
    } else if (type === 'skyscraper') {
      const width = (buildingData.width || 4) * 2;
      const depth = (buildingData.depth || 4) * 2;
      const height = (buildingData.height || 15);
      group.userData.collisionRadius = Math.max(width, depth) / 2 + 3; // Add margin
      group.userData.buildingWidth = width;
      group.userData.buildingDepth = depth;
      group.userData.buildingHeight = height;
    }

    group.matrixAutoUpdate = false;
    group.updateMatrix();

    return group;
  }

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

  const createPlayer = (spawn, customY = null) => {
    const group = new THREE.Group();
    let yPosition;
    
    if (customY !== null) {
      // Use custom Y position (e.g., on top of building)
      yPosition = customY;
    } else {
      // Use terrain height
    const yOffset = getHeightAt(spawn.x, spawn.z);
      yPosition = yOffset + 1;
    }

    const geometry = new THREE.SphereGeometry(1, 32, 32);
    geometry.scale(1, 1, 1.4);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffdd, roughness: 0.5, metalness: 0.1 });
    const egg = new THREE.Mesh(geometry, material);
    egg.castShadow = true;
    egg.receiveShadow = true;
    egg.rotation.x = Math.PI / 2;
    group.add(egg);

    // Add a point light that follows the player to keep them visible at all times
    const playerLight = new THREE.PointLight(0xffffdd, 0.8, 8); // Warm light, medium intensity, 8 unit range
    playerLight.position.set(0, 0, 0); // Relative to player group
    playerLight.castShadow = false; // Don't cast shadows to avoid performance issues
    group.add(playerLight);

    group.position.set(spawn.x, yPosition, spawn.z);
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

      const biomeName = data.world?.biome || data.world?.biome_name;
      createGround(scene, biomeName);

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
            // Calculate tree radius based on leaf size and scale
            // Leaf size: max(3 * scale for leafless, 2.2 * scale for normal) + random offset (0.6 * scale)
            const scale = treeData.scale || 1.0;
            const leafSize = treeData.leafless ? 3 * scale : 2.2 * scale;
            const randomOffset = 0.6 * scale;
            const treeRadius = leafSize + randomOffset + 1; // +1 for safety margin
            
            // Check if radius around tree position is clear
            if (!checkRadiusClear(
              treeData.position.x,
              treeData.position.z,
              treeRadius,
              terrainPlacementMaskRef.current
            )) {
              return; // Skip this tree if radius is occupied
            }

            const tree = createTree(treeData);
            tree.userData = { 
              structureType: 'tree',
              scale: treeData.scale || 1.0,
              leafless: treeData.leafless || false
            };
            scene.add(tree);
            structuresRef.current.push(tree);
            
            // Mark radius around tree as occupied
            markRadiusOccupied(
              treeData.position.x,
              treeData.position.z,
              treeRadius,
              terrainPlacementMaskRef.current
            );
          });
          console.log(`✅ Added ${structuresRef.current.filter(obj => obj.userData.structureType === 'tree').length} trees`);
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
          console.log(`✅ Added ${data.structures.rocks.length} rocks`);
        }
        
        if (data.structures.peaks) {
          data.structures.peaks.forEach(peakData => {
            const peak = createMountainPeak(peakData);
            peak.userData = { structureType: 'peak' };
            scene.add(peak);
            structuresRef.current.push(peak);
          });
          console.log(`✅ Added ${data.structures.peaks.length} mountain peaks`);
        }

        if (data.structures.street_lamps) {
          console.log(`[FRONTEND] Creating ${data.structures.street_lamps.length} street lamps...`);
          // Determine if it's night based on time or lighting
          const timeOfDay = data.world?.time || 'noon';
          const isNight = timeOfDay === 'night' || timeOfDay === 'midnight' || timeOfDay === 'evening';
          // Also check lighting config if available
          let isNightFromLighting = false;
          if (data.world?.lighting_config?.background) {
            const bgColor = new THREE.Color(data.world.lighting_config.background);
            const hsl = {};
            bgColor.getHSL(hsl);
            isNightFromLighting = hsl.l < 0.3; // Dark background = night
          }
          const shouldGlow = isNight || isNightFromLighting;
          
          data.structures.street_lamps.forEach(lampData => {
            const lamp = createStreetLamp(lampData, shouldGlow);
            lamp.userData = { structureType: 'street_lamp' };
            scene.add(lamp);
            structuresRef.current.push(lamp);
          });
          console.log(`✅ Added ${data.structures.street_lamps.length} street lamps (glowing: ${shouldGlow})`);
        }

          if (data.structures?.buildings) {
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

              // Merge userData to preserve windows data from createBuilding
              building.userData = {
                ...building.userData,
                structureType: 'building',
                buildingType,
              };

              scene.add(building);
              structuresRef.current.push(building);
            });

          // Update terrainPlacementMask to mark building locations as occupied (with radius)
          data.structures.buildings.forEach((buildingData, idx) => {
            const gridIndex = Math.floor(idx / (buildingGridConfig.gridSizeX * buildingGridConfig.gridSizeZ));
            const localIndex = idx % (buildingGridConfig.gridSizeX * buildingGridConfig.gridSizeZ);
            const gridOrigin = buildingGridOrigins[gridIndex % buildingGridOrigins.length];
            const gridPos = getBuildingGridPosition(localIndex, buildingGridConfig, gridOrigin);

            // Calculate building radius based on dimensions
            const buildingWidth = (buildingData.width || 4) * 2;
            const buildingDepth = (buildingData.depth || 4) * 2;
            const buildingRadius = Math.max(buildingWidth, buildingDepth) / 2 + 2; // Add margin
            
            // Mark radius around building as occupied
            markRadiusOccupied(
              gridPos.x,
              gridPos.z,
              buildingRadius,
              terrainPlacementMaskRef.current
            );
          });

          // For city biome, add 3 randomly scattered skyscrapers
          // Try multiple sources for biome name (biome or biome_name)
          const biomeFromData = data?.world?.biome || data?.world?.biome_name;
          const biomeFromState = currentWorld?.world?.biome || currentWorld?.world?.biome_name;
          const currentBiomeName = biomeFromData || biomeFromState || biomeName;
          
          console.log(`[SKYSCRAPERS] Debug - biomeName: ${biomeName}, data.world?.biome: ${data?.world?.biome}, currentBiomeName: ${currentBiomeName}`);
          
          if (currentBiomeName && currentBiomeName.toLowerCase() === 'city') {
            console.log('[SKYSCRAPERS] Creating 3 random skyscrapers for city biome');
            const skyscraperCount = 3;
            const terrainSize = 256;
            const minDistance = 30; // Minimum distance from grid buildings and other skyscrapers
            
            for (let i = 0; i < skyscraperCount; i++) {
              let attempts = 0;
              let validPosition = false;
              let randomX, randomZ;
              
              while (!validPosition && attempts < 100) {
                // Random position within terrain bounds
                randomX = (Math.random() - 0.5) * terrainSize * 0.7;
                randomZ = (Math.random() - 0.5) * terrainSize * 0.7;
                
                // Check distance from grid buildings
                let tooClose = false;
                for (const cellKey of occupiedCells) {
                  const [cellX, cellZ] = cellKey.split(':').map(Number);
                  const dist = Math.sqrt((randomX - cellX) ** 2 + (randomZ - cellZ) ** 2);
                  if (dist < minDistance) {
                    tooClose = true;
                    break;
                  }
                }
                
                // Check distance from already placed skyscrapers
                if (!tooClose) {
                  const existingSkyscrapers = structuresRef.current.filter(
                    s => s.userData?.buildingType === 'skyscraper'
                  );
                  for (const existing of existingSkyscrapers) {
                    const dist = Math.sqrt(
                      (randomX - existing.position.x) ** 2 + (randomZ - existing.position.z) ** 2
                    );
                    if (dist < minDistance) {
                      tooClose = true;
                      break;
                    }
                  }
                }
                
                if (!tooClose) {
                  validPosition = true;
                }
                attempts++;
              }
              
              // If we couldn't find a valid position after many attempts, place it anyway at a random location
              if (!validPosition) {
                randomX = (Math.random() - 0.5) * terrainSize * 0.7;
                randomZ = (Math.random() - 0.5) * terrainSize * 0.7;
                console.log(`[SKYSCRAPERS] Warning: Could not find ideal position for skyscraper ${i + 1}, placing at (${randomX.toFixed(1)}, ${randomZ.toFixed(1)})`);
              }
              
              // Create skyscraper building data
              const skyscraperData = {
                height: 25 + Math.random() * 15, // Height between 25-40
                width: 6 + Math.random() * 4,    // Width between 6-10
                depth: 6 + Math.random() * 4,    // Depth between 6-10
                position: { x: randomX, y: 0, z: randomZ }
              };
              
              console.log(`[SKYSCRAPERS] Creating skyscraper ${i + 1} at (${randomX.toFixed(1)}, ${randomZ.toFixed(1)})`);
              
              const skyscraper = createBuilding(
                skyscraperData,
                0, // idx not used for non-grid buildings
                'skyscraper',
                null // null gridOrigin means use buildingData.position
              );
              
              skyscraper.userData = {
                ...skyscraper.userData,
                structureType: 'building',
                buildingType: 'skyscraper',
              };
              
              scene.add(skyscraper);
              structuresRef.current.push(skyscraper);
              
              // Mark skyscraper radius in terrainPlacementMask
              const skyscraperWidth = (skyscraperData.width || 4) * 2;
              const skyscraperDepth = (skyscraperData.depth || 4) * 2;
              const skyscraperRadius = Math.max(skyscraperWidth, skyscraperDepth) / 2 + 3;
              markRadiusOccupied(
                randomX,
                randomZ,
                skyscraperRadius,
                terrainPlacementMaskRef.current
              );
              
              console.log(`[SKYSCRAPERS] Successfully added skyscraper ${i + 1}`);
            }
            console.log(`[SKYSCRAPERS] Total skyscrapers created: ${structuresRef.current.filter(s => s.userData?.buildingType === 'skyscraper').length}`);
          } else {
            console.log(`[SKYSCRAPERS] Biome is not city (biomeName: ${biomeName}, data.world?.biome_name: ${data.world?.biome_name}), skipping skyscraper creation`);
          }

        }
      }

      // Determine spawn location - on top of building if city biome
      let spawn = data.spawn_point || { x: 0, z: 0 };
      let spawnY = null;
      
      const spawnBiomeName = data.world?.biome || data.world?.biome_name;
      if (spawnBiomeName && spawnBiomeName.toLowerCase() === 'city') {
        // Find a building to spawn on top of
        const buildings = structuresRef.current.filter(
          s => s.userData?.structureType === 'building'
        );
        
        if (buildings.length > 0) {
          // Pick a random building (or first one)
          const building = buildings[Math.floor(Math.random() * buildings.length)];
          const buildingHeight = building.userData?.buildingHeight || 0;
          spawn = {
            x: building.position.x,
            z: building.position.z
          };
          // Spawn on top of building (building position.y is at terrain level, add building height)
          // Building height is the full height, so top is at position.y + buildingHeight
          spawnY = building.position.y + buildingHeight + 2; // +2 for player radius/height
          console.log(`[SPAWN] Building at (${building.position.x.toFixed(1)}, ${building.position.y.toFixed(1)}, ${building.position.z.toFixed(1)})`);
          console.log(`[SPAWN] Building height: ${buildingHeight.toFixed(1)}`);
          console.log(`[SPAWN] Spawning player on top at (${spawn.x.toFixed(1)}, ${spawnY.toFixed(1)}, ${spawn.z.toFixed(1)})`);
        } else {
          console.log(`[SPAWN] No buildings found, using default spawn`);
        }
      }
      
      const playerMesh = createPlayer(spawn, spawnY);
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
    
    // Add command to chat history
    setChatHistory(prev => [...prev, {
      command: commandText,
      timestamp: new Date().toLocaleTimeString(),
      type: 'user'
    }]);
    
    setGameState(GameState.GENERATING);
    try {
      // Get player position for relative positioning
      const playerPos = playerRef.current ? {
        x: playerRef.current.position.x,
        y: playerRef.current.position.y,
        z: playerRef.current.position.z
      } : null;
      
      // Get camera direction for "in front of me" calculations
      let playerDirection = null;
      if (cameraRef.current && playerRef.current) {
        const camDir = new THREE.Vector3();
        cameraRef.current.getWorldDirection(camDir);
        camDir.y = 0;
        camDir.normalize();
        playerDirection = {
          x: camDir.x,
          z: camDir.z
        };
      }
      
      const payload = {
        command: commandText,
        current_world: currentWorld,
        player_position: playerPos,
        player_direction: playerDirection,
        from_time: null,       
        to_time: null,         
        progress: 1.0,          
        image_data: uploadedImage ? uploadedImage : null,  // base64 image data
      };
      
      if (uploadedImage) {
        console.log("[FRONTEND] Image uploaded, sending to backend. Image data length:", uploadedImage.length);
      }

      const res = await fetch(`${API_BASE}/modify-world`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      console.log("API response status:", res.status);

      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      console.log("=== FRONTEND: Modify response ===", data);
      console.log("=== FRONTEND: Trees in response ===", data.structures?.trees);
      if (data.structures?.trees && data.structures.trees.length > 0) {
        console.log("=== FRONTEND: First tree sample ===", JSON.stringify(data.structures.trees[0], null, 2));
      }

      const scene = sceneRef.current;
      if (!scene) return;

      // Store old counts
      const oldTreeCount = currentWorld?.structures?.trees?.length || 0;
      const oldRockCount = currentWorld?.structures?.rocks?.length || 0;
      const oldBuildingCount = currentWorld?.structures?.buildings?.length || 0;
      const oldSkyscraperCount = structuresRef.current.filter(s => s.userData?.buildingType === 'skyscraper').length;
      const oldHouseCount = structuresRef.current.filter(s => s.userData?.buildingType === 'house' || (s.userData?.buildingType !== 'skyscraper' && s.userData?.structureType === 'building')).length;
      const oldPeakCount = currentWorld?.structures?.peaks?.length || 0;
      const oldStreetLampCount = currentWorld?.structures?.street_lamps?.length || 0;
      const oldEnemyCount = currentWorld?.combat?.enemies?.length || 0;

      console.log("Old counts - Trees:", oldTreeCount, "Rocks:", oldRockCount, "Buildings:", oldBuildingCount, "Skyscrapers:", oldSkyscraperCount, "Houses:", oldHouseCount, "Peaks:", oldPeakCount, "Street Lamps:", oldStreetLampCount, "Enemies:", oldEnemyCount);

      // Get new counts
      const newTreeCount = data.structures?.trees?.length || 0;
      const newRockCount = data.structures?.rocks?.length || 0;
      const newBuildingCount = data.structures?.buildings?.length || 0;
      const newPeakCount = data.structures?.peaks?.length || 0;
      const newStreetLampCount = data.structures?.street_lamps?.length || 0;
      const newEnemyCount = data.combat?.enemies?.length || 0;

      // Count skyscrapers and houses in new data
      // Check both 'type' field (from backend) and 'buildingType' in userData (from frontend)
      const newSkyscraperCount = data.structures?.buildings?.filter(b => 
        b.type === 'skyscraper' || b.buildingType === 'skyscraper'
      ).length || 0;
      const newHouseCount = data.structures?.buildings?.filter(b => 
        b.type !== 'skyscraper' && b.buildingType !== 'skyscraper' && b.type !== 'igloo'
      ).length || 0;

      console.log("New counts - Trees:", newTreeCount, "Rocks:", newRockCount, "Buildings:", newBuildingCount, "Skyscrapers:", newSkyscraperCount, "Houses:", newHouseCount, "Peaks:", newPeakCount, "Street Lamps:", newStreetLampCount, "Enemies:", newEnemyCount);

      // Check if trees have color properties (indicates styling update via "set")
      const treesHaveColors = data.structures?.trees?.some(t => t.leaf_color || t.trunk_color) || false;
      console.log(`[MODIFY] Trees check - hasColors: ${treesHaveColors}, oldCount: ${oldTreeCount}, newCount: ${newTreeCount}`);
      if (data.structures?.trees && data.structures.trees.length > 0) {
        console.log(`[MODIFY] Sample tree data:`, JSON.stringify(data.structures.trees[0], null, 2));
        // Check each tree for colors
        data.structures.trees.forEach((tree, idx) => {
          const hasLeafColor = 'leaf_color' in tree;
          const hasTrunkColor = 'trunk_color' in tree;
          console.log(`[MODIFY] Tree ${idx}: hasLeafColor=${hasLeafColor}, hasTrunkColor=${hasTrunkColor}, leaf_color=${tree.leaf_color}, trunk_color=${tree.trunk_color}`);
        });
      }
      
      // Also check if we should replace trees when count matches (even without colors, if it's a "set" operation)
      // The backend "set" operation means we should replace all trees
      const shouldReplaceAllTrees = (treesHaveColors && newTreeCount === oldTreeCount) || 
                                     (newTreeCount === oldTreeCount && newTreeCount > 0 && oldTreeCount > 0);
      
      console.log(`[MODIFY] shouldReplaceAllTrees: ${shouldReplaceAllTrees} (hasColors: ${treesHaveColors}, counts match: ${newTreeCount === oldTreeCount})`);
      
      if (shouldReplaceAllTrees) {
        // Replace all trees (for styling updates with colors)
        console.log(`[MODIFY] Replacing all ${oldTreeCount} trees with styled versions...`);
        // Remove all existing trees
        const treesToRemove = structuresRef.current.filter(obj => obj.userData?.structureType === 'tree');
        treesToRemove.forEach(tree => {
          scene.remove(tree);
        });
        structuresRef.current = structuresRef.current.filter(obj => obj.userData?.structureType !== 'tree');
        
        // Add all new styled trees
        // Note: We don't check radius here because we're replacing trees at their exact positions
        // The old trees were already removed, so we can place new ones at the same positions
        let treesAdded = 0;
        data.structures.trees.forEach((treeData, idx) => {
          const scale = treeData.scale || 1.0;
          const leafSize = treeData.leafless ? 3 * scale : 2.2 * scale;
          const randomOffset = 0.6 * scale;
          const treeRadius = leafSize + randomOffset + 1;

          const tree = createTree(treeData);
          tree.userData = { 
            ...tree.userData, 
            structureType: 'tree',
            scale: treeData.scale || 1.0,
            leafless: treeData.leafless || false
          };
          scene.add(tree);
          structuresRef.current.push(tree);
          
          // Mark radius as occupied (replacing old tree position)
          markRadiusOccupied(
            treeData.position.x,
            treeData.position.z,
            treeRadius,
            terrainPlacementMaskRef.current
          );
          treesAdded++;
          console.log(`[MODIFY] Added tree ${idx + 1}/${data.structures.trees.length} at (${treeData.position.x.toFixed(1)}, ${treeData.position.z.toFixed(1)}) with colors: leaf=${treeData.leaf_color || 'none'}, trunk=${treeData.trunk_color || 'none'}`);
        });
        console.log(`[MODIFY] ✅ Successfully replaced trees: ${treesAdded} trees added`);
      } else if (newTreeCount < oldTreeCount) {
      // Handle REMOVALS (if counts decreased)
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

      // Handle skyscraper removals separately
      if (newSkyscraperCount < oldSkyscraperCount) {
        const toRemove = oldSkyscraperCount - newSkyscraperCount;
        console.log(`[MODIFY] Removing ${toRemove} skyscrapers...`);
        for (let i = 0; i < toRemove; i++) {
          const skyscraper = structuresRef.current.find(obj => 
            obj.userData?.structureType === 'building' && obj.userData?.buildingType === 'skyscraper'
          );
          if (skyscraper) {
            scene.remove(skyscraper);
            structuresRef.current = structuresRef.current.filter(obj => obj !== skyscraper);
          }
        }
      }
      
      // Handle house removals separately
      if (newHouseCount < oldHouseCount) {
        const toRemove = oldHouseCount - newHouseCount;
        console.log(`[MODIFY] Removing ${toRemove} houses...`);
        for (let i = 0; i < toRemove; i++) {
          const house = structuresRef.current.find(obj => 
            obj.userData?.structureType === 'building' && 
            (obj.userData?.buildingType === 'house' || obj.userData?.buildingType !== 'skyscraper')
          );
          if (house) {
            scene.remove(house);
            structuresRef.current = structuresRef.current.filter(obj => obj !== house);
          }
        }
      }
      
      // Handle general building removals (if total count decreased but not type-specific)
      if (newBuildingCount < oldBuildingCount && newSkyscraperCount >= oldSkyscraperCount && newHouseCount >= oldHouseCount) {
        const toRemove = oldBuildingCount - newBuildingCount;
        console.log(`[MODIFY] Removing ${toRemove} buildings (general)...`);
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

      if (newStreetLampCount < oldStreetLampCount) {
        const toRemove = oldStreetLampCount - newStreetLampCount;
        console.log(`[MODIFY] Removing ${toRemove} street lamps...`);
        for (let i = 0; i < toRemove; i++) {
          const lamp = structuresRef.current.find(obj => obj.userData?.structureType === 'street_lamp');
          if (lamp) {
            scene.remove(lamp);
            structuresRef.current = structuresRef.current.filter(obj => obj !== lamp);
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
          // Calculate tree radius based on leaf size and scale
          const scale = treeData.scale || 1.0;
          const leafSize = treeData.leafless ? 3 * scale : 2.2 * scale;
          const randomOffset = 0.6 * scale;
          const treeRadius = leafSize + randomOffset + 1; // +1 for safety margin
          
          // Check if radius around tree position is clear
          if (!checkRadiusClear(
            treeData.position.x,
            treeData.position.z,
            treeRadius,
            terrainPlacementMaskRef.current
          )) {
            return; // Skip this tree if radius is occupied
          }

          const tree = createTree(treeData);
          tree.userData = { 
            ...tree.userData, 
            structureType: 'tree',
            scale: treeData.scale || 1.0,
            leafless: treeData.leafless || false
          };
          scene.add(tree);
          structuresRef.current.push(tree);
          
          // Mark radius around tree as occupied
          markRadiusOccupied(
            treeData.position.x,
            treeData.position.z,
            treeRadius,
            terrainPlacementMaskRef.current
          );
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

          // Merge userData to preserve windows data from createBuilding
          building.userData = {
            ...building.userData,
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

      if (data.structures?.street_lamps && newStreetLampCount > oldStreetLampCount) {
        const newStreetLamps = data.structures.street_lamps.slice(oldStreetLampCount);
        console.log(`[MODIFY] Adding ${newStreetLamps.length} new street lamps...`);
        
        // Determine if it's night
        const timeOfDay = data.world?.time || 'noon';
        const isNight = timeOfDay === 'night' || timeOfDay === 'midnight' || timeOfDay === 'evening';
        let isNightFromLighting = false;
        if (data.world?.lighting_config?.background) {
          const bgColor = new THREE.Color(data.world.lighting_config.background);
          const hsl = {};
          bgColor.getHSL(hsl);
          isNightFromLighting = hsl.l < 0.3;
        }
        const shouldGlow = isNight || isNightFromLighting;
        
        newStreetLamps.forEach(lampData => {
          const lamp = createStreetLamp(lampData, shouldGlow);
          lamp.userData = { structureType: 'street_lamp' };
          scene.add(lamp);
          structuresRef.current.push(lamp);
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
      
      // Add success message to chat history
      setChatHistory(prev => [...prev, {
        command: `✅ Command executed successfully`,
        timestamp: new Date().toLocaleTimeString(),
        type: 'system'
      }]);
      
      setGameState(GameState.PLAYING);
      console.log("✅ Modification complete, returned to PLAYING state");
      
      // Clear uploaded image after successful modification
      if (uploadedImage) {
        setUploadedImage(null);
        setImagePreview(null);
      }
    } catch (err) {
      console.error("Modify-world error:", err);
      // Add error message to chat history
      setChatHistory(prev => [...prev, {
        command: `❌ Error: ${err.message}`,
        timestamp: new Date().toLocaleTimeString(),
        type: 'error'
      }]);
      setGameState(GameState.PLAYING);
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }
    
    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('Image size must be less than 5MB');
      return;
    }
    
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result;
      setUploadedImage(base64String);
      setImagePreview(base64String);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    setUploadedImage(null);
    setImagePreview(null);
    // Reset file input
    const fileInput = document.getElementById('tree-image-upload');
    if (fileInput) fileInput.value = '';
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
      const isNight = hsl.l < 0.3;
      let horizonColor, middleColor, topColor;
      
      if (isNight) {
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
      
      // Update street lamps to glow only at night
      structuresRef.current.forEach(structure => {
        if (structure.userData?.structureType === 'street_lamp') {
          // Find the bulb mesh (should be the 3rd child: pole, head, bulb)
          const bulb = structure.children.find(child => 
            child.isMesh && child.material && child.material.emissive
          );
          if (bulb) {
            if (isNight) {
              bulb.material.color.setHex(0xFFFFAA);
              bulb.material.emissive.setHex(0xFFFF88);
              bulb.material.emissiveIntensity = 0.8;
            } else {
              bulb.material.color.setHex(0x666666);
              bulb.material.emissive.setHex(0x000000);
              bulb.material.emissiveIntensity = 0;
            }
          }
          
          // Update point lights (if they exist)
          structure.children.forEach(child => {
            if (child.isPointLight) {
              child.visible = isNight;
              child.intensity = isNight ? 0.4 : 0;
            }
          });
        }
        
        // Update building windows to glow at night
        if (structure.userData?.structureType === 'building' && structure.userData?.windows) {
          structure.userData.windows.forEach(windowData => {
            if (windowData.mesh && windowData.mesh.material) {
              if (isNight) {
                windowData.mesh.material.color.setHex(windowData.color);
                windowData.mesh.material.emissive.setHex(windowData.color);
                windowData.mesh.material.emissiveIntensity = 0.8;
              } else {
                windowData.mesh.material.color.setHex(0x333333);
                windowData.mesh.material.emissive.setHex(0x000000);
                windowData.mesh.material.emissiveIntensity = 0;
              }
            }
          });
        }
      });
      
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
 
  const handlePhysicsChange = useCallback((newSettings) => {
    setPhysicsSettings(newSettings);
  }, []);
 
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

      <GameSettingsPanel 
        onSettingsChange={handlePhysicsChange}
        initialSettings={physicsSettings}
      />

      {gameState === GameState.PLAYING && (
        <>
          <button
            onClick={() => {
              setGameState(GameState.IDLE);
              // Clear the scene
              const scene = sceneRef.current;
              if (scene) {
                const objectsToRemove = [];
                scene.children.forEach((child) => {
                  if (!child.isLight && !child.userData?.isSky) objectsToRemove.push(child);
                });
                objectsToRemove.forEach((obj) => scene.remove(obj));
              }
              terrainMeshRef.current = null;
              enemiesRef.current = [];
              structuresRef.current = [];
              occupiedCells.clear();
              heightmapRef.current = null;
              colorMapRef.current = null;
              terrainPlacementMaskRef.current = null;
              setCurrentWorld(null);
            }}
            style={{
              position: 'absolute',
              top: 20,
              right: 20,
              zIndex: 10,
              padding: '12px 24px',
              backgroundColor: 'rgba(100, 100, 200, 0.8)',
              color: '#fff',
              border: '2px solid rgba(150, 150, 255, 0.9)',
              borderRadius: '8px',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: '14px',
              fontWeight: 'bold',
              transition: 'all 0.3s ease',
              boxShadow: '0 4px 6px rgba(0,0,0,0.3)'
            }}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = 'rgba(120, 120, 220, 0.95)';
              e.target.style.transform = 'scale(1.05)';
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = 'rgba(100, 100, 200, 0.8)';
              e.target.style.transform = 'scale(1)';
            }}
          >
            ðŸ              🏠 Home
          </button>

          <button
            onClick={() => setShowChatHistory(!showChatHistory)}
            style={{
              position: 'absolute',
              top: 20,
              right: 140,
              zIndex: 10,
              padding: '12px 24px',
              backgroundColor: 'rgba(100, 100, 200, 0.8)',
              color: '#fff',
              border: '2px solid rgba(150, 150, 255, 0.9)',
              borderRadius: '8px',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: '14px',
              fontWeight: 'bold',
              transition: 'all 0.3s ease',
              boxShadow: '0 4px 6px rgba(0,0,0,0.3)'
            }}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = 'rgba(120, 120, 220, 0.95)';
              e.target.style.transform = 'scale(1.05)';
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = 'rgba(100, 100, 200, 0.8)';
              e.target.style.transform = 'scale(1)';
            }}
          >
            💬 Chat History
          </button>

          {/* Chat History Side Panel */}
          {showChatHistory && (
            <div style={{
              position: 'fixed',
              top: 0,
              right: 0,
              width: '400px',
              height: '100vh',
              backgroundColor: 'rgba(20, 20, 30, 0.95)',
              borderLeft: '2px solid rgba(150, 150, 255, 0.5)',
              zIndex: 100,
              overflowY: 'auto',
              boxShadow: '-4px 0 10px rgba(0,0,0,0.5)',
              transition: 'transform 0.3s ease'
            }}>
              <div style={{
                padding: '20px',
                borderBottom: '1px solid rgba(150, 150, 255, 0.3)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <h3 style={{ color: '#fff', margin: 0, fontFamily: 'monospace' }}>Chat History</h3>
                <button
                  onClick={() => setShowChatHistory(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#fff',
                    fontSize: '24px',
                    cursor: 'pointer',
                    padding: '0 10px'
                  }}
                >
                  Ã—
                </button>
              </div>
              <div style={{ padding: '20px' }}>
                {chatHistory.length === 0 ? (
                  <div style={{ color: '#888', textAlign: 'center', marginTop: '40px' }}>
                    No chat history yet
                  </div>
                ) : (
                  chatHistory.map((item, index) => (
                    <div
                      key={index}
                      style={{
                        marginBottom: '15px',
                        padding: '12px',
                        backgroundColor: item.type === 'error' 
                          ? 'rgba(200, 100, 100, 0.2)' 
                          : item.type === 'system'
                          ? 'rgba(100, 200, 100, 0.2)'
                          : 'rgba(100, 100, 200, 0.2)',
                        borderRadius: '8px',
                        borderLeft: `3px solid ${
                          item.type === 'error' 
                            ? 'rgba(255, 100, 100, 0.8)' 
                            : item.type === 'system'
                            ? 'rgba(100, 255, 100, 0.8)'
                            : 'rgba(150, 150, 255, 0.8)'
                        }`
                      }}
                    >
                      <div style={{
                        color: '#aaa',
                        fontSize: '11px',
                        marginBottom: '5px',
                        fontFamily: 'monospace'
                      }}>
                        {item.timestamp}
                      </div>
                      <div style={{
                        color: '#fff',
                        fontSize: '14px',
                        fontFamily: 'monospace',
                        wordWrap: 'break-word'
                      }}>
                        {item.type === 'user' ? (
                          <><strong style={{ color: '#88aaff' }}>You:</strong> {item.command}</>
                        ) : item.type === 'system' ? (
                          <><strong style={{ color: '#88ff88' }}>System:</strong> {item.command}</>
                        ) : (
                          <><strong style={{ color: '#ff8888' }}>Error:</strong> {item.command}</>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

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
            zIndex: 20, display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center'
          }}>
            {/* Image Upload Section */}
            {imagePreview && (
              <div style={{
                position: 'relative',
                marginBottom: '10px',
                padding: '8px',
                backgroundColor: 'rgba(220, 220, 220, 0.9)',
                border: '2px solid #000',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <img 
                  src={imagePreview} 
                  alt="Preview" 
                  style={{
                    width: '60px',
                    height: '60px',
                    objectFit: 'cover',
                    borderRadius: '4px',
                    border: '1px solid #000'
                  }}
                />
                <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#000' }}>
                  Tree reference image uploaded
                </span>
                <button
                  onClick={handleRemoveImage}
                  style={{
                    background: 'rgba(255, 100, 100, 0.8)',
                    border: '1px solid #000',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    color: '#fff'
                  }}
                >
                  ✕
                </button>
              </div>
            )}
            
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <div className="speech-bubble-wrapper">
            <input
              type="text"
              value={modifyPrompt}
              onChange={e => setModifyPrompt(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && handleModifySubmit()}
                  placeholder={uploadedImage ? "Type command (e.g., 'make trees look like this')..." : "Type command (e.g., 'add 5 trees')..."}
                  className="speech-bubble-input"
                />
                <div className="speech-bubble-tail"></div>
                <div className="speech-bubble-blue-accent"></div>
              </div>
              
              {/* Image Upload Button */}
              <label
                htmlFor="tree-image-upload"
              style={{
                  padding: '12px 16px',
                  backgroundColor: uploadedImage ? 'rgba(100, 200, 100, 0.8)' : 'rgba(100, 100, 200, 0.8)',
                color: '#fff',
                  border: '2px solid #000',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                onMouseEnter={(e) => {
                  e.target.style.backgroundColor = uploadedImage ? 'rgba(120, 220, 120, 0.95)' : 'rgba(120, 120, 220, 0.95)';
                  e.target.style.transform = 'scale(1.05)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.backgroundColor = uploadedImage ? 'rgba(100, 200, 100, 0.8)' : 'rgba(100, 100, 200, 0.8)';
                  e.target.style.transform = 'scale(1)';
                }}
              >
                📷 {uploadedImage ? 'Image' : 'Upload'}
              </label>
              <input
                id="tree-image-upload"
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                style={{ display: 'none' }}
              />
              
            <button
              onClick={handleModifySubmit}
                className="speech-bubble-button"
            >
              Modify
            </button>
            </div>
            <style>{`
              .speech-bubble-wrapper {
                position: relative;
                display: inline-block;
              }
              
              .speech-bubble-input {
                padding: 12px 20px;
                fontSize: 14px;
                width: 300px;
                background: rgba(220, 220, 220, 0.3);
                color: #000;
                border: 2px solid #000;
                border-radius: 8px;
                outline: none;
                font-family: 'Courier New', monospace;
                transition: all 0.2s ease;
                position: relative;
                image-rendering: pixelated;
                image-rendering: -moz-crisp-edges;
                image-rendering: crisp-edges;
              }
              
              .speech-bubble-tail {
                position: absolute;
                bottom: -10px;
                left: 50%;
                transform: translateX(-50%);
                width: 0;
                height: 0;
                border-left: 10px solid transparent;
                border-right: 10px solid transparent;
                border-top: 10px solid #000;
                image-rendering: pixelated;
                z-index: 1;
              }
              
              .speech-bubble-tail::after {
                content: '';
                position: absolute;
                bottom: 2px;
                left: 50%;
                transform: translateX(-50%);
                width: 0;
                height: 0;
                border-left: 8px solid transparent;
                border-right: 8px solid transparent;
                border-top: 8px solid rgba(220, 220, 220, 0.3);
                image-rendering: pixelated;
              }
              
              .speech-bubble-blue-accent {
                position: absolute;
                top: 2px;
                right: 2px;
                bottom: -8px;
                width: 2px;
                background: transparent;
                transition: all 0.2s ease;
                pointer-events: none;
                z-index: 2;
              }
              
              .speech-bubble-wrapper:hover .speech-bubble-input,
              .speech-bubble-input:focus {
                background: rgba(220, 220, 220, 0.95);
              }
              
              .speech-bubble-wrapper:hover .speech-bubble-blue-accent {
                background: #0000ff;
                top: 2px;
                right: 2px;
                bottom: -8px;
                width: 2px;
              }
              
              .speech-bubble-wrapper:hover .speech-bubble-tail::after {
                border-top-color: rgba(220, 220, 220, 0.95);
              }
              
              .speech-bubble-button {
                padding: 12px 24px;
                fontSize: 14px;
                fontWeight: bold;
                background: rgba(220, 220, 220, 0.3);
                color: #000;
                border: 2px solid #000;
                borderRadius: 8px;
                cursor: pointer;
                font-family: 'Courier New', monospace;
                transition: all 0.2s ease;
                position: relative;
                image-rendering: pixelated;
                image-rendering: -moz-crisp-edges;
                image-rendering: crisp-edges;
              }
              
              .speech-bubble-button::before {
                content: '';
                position: absolute;
                top: 2px;
                right: 2px;
                bottom: 2px;
                width: 2px;
                background: transparent;
                transition: all 0.2s ease;
                pointer-events: none;
              }
              
              .speech-bubble-button:hover {
                background: rgba(220, 220, 220, 0.95);
              }
              
              .speech-bubble-button:hover::before {
                background: #0000ff;
              }
            `}</style>
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
              {isListening ? '🎤' : '🎮'}
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
            {isListening ? '🎤 Listening...' : '🎤 Speak to Create'}
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
            Cooking up <span style={{ color: '#4fa3ff' }}>YOUR</span> worldâ€¦
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