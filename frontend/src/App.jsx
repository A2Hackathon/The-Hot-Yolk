import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import GameSettingsPanel from './GameSettingsPanel';
import ColorPicker from './ColorPicker';
import { RealtimeVision } from '@overshoot/sdk';

// Overshoot API configuration (used directly in frontend via SDK)
const OVERSHOOT_API_URL = 'https://cluster1.overshoot.ai/api/v0.2';
const OVERSHOOT_API_KEY = 'ovs_2d4ab5e6aa5d635976e707712176fe5b';


const API_BASE = 'http://localhost:8000/api';

const GameState = {
  IDLE: 'idle',
  LISTENING: 'listening',
  CHATTING: 'chatting',
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
  const [chatConversation, setChatConversation] = useState([]);
  const [isWaitingForAI, setIsWaitingForAI] = useState(false);
  const [historyChatInput, setHistoryChatInput] = useState('');
  const [uploadedImage, setUploadedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [scanMode, setScanMode] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const videoRef = useRef(null);
  const overshootVisionRef = useRef(null);
  const [streamingActive, setStreamingActive] = useState(false);
  const [lastScanResult, setLastScanResult] = useState(null);
  const [editingMode, setEditingMode] = useState(false);
  const editingModeRef = useRef(false);
  const [selectedStructure, setSelectedStructure] = useState(null);
  const selectedStructureRef = useRef(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const lebronBillboardRef = useRef(null);
  const mouseRef = useRef(new THREE.Vector2());
  const dragOffsetRef = useRef(new THREE.Vector3());
  const isDraggingRef = useRef(false);
  const [physicsSettings, setPhysicsSettings] = useState({
    speed: 5.0,
    gravity: 30.0,
    jumpHeight: 3.0
  });
  const physicsSettingsRef = useRef(physicsSettings);
  const [colorPalette, setColorPalette] = useState(null);
  const [colorSchemeNotification, setColorSchemeNotification] = useState('');
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

  // Sync editingModeRef with editingMode state so animate function can access current value
  useEffect(() => {
    editingModeRef.current = editingMode;
  }, [editingMode]);

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
          const jumpVelocity = physicsSettingsRef.current.jumpHeight * 0.133;
          playerState.current.velocity.y = jumpVelocity;
          playerState.current.isGrounded = false;
        } else if (playerState.current.canDoubleJump) {
          const jumpVelocity = physicsSettingsRef.current.jumpHeight * 0.133;
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
      animateNorthernLights(sceneRef.current);
      
      // Editing mode: Handle structure dragging
      if (editingModeRef.current && isDraggingRef.current && selectedStructureRef.current && cameraRef.current && rendererRef.current) {
        const structure = selectedStructureRef.current;
        const raycaster = raycasterRef.current;
        const mouse = mouseRef.current;
        
        // Update raycaster with current mouse position
        raycaster.setFromCamera(mouse, cameraRef.current);
        
        // Intersect with ground plane at structure's current Y position (not y=0)
        // This keeps the structure at its current height while dragging
        const structureY = structure.position.y;
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -structureY);
        const intersectPoint = new THREE.Vector3();
        const result = raycaster.ray.intersectPlane(plane, intersectPoint);
        
        if (result !== null) {
          structure.position.x = intersectPoint.x + dragOffsetRef.current.x;
          structure.position.z = intersectPoint.z + dragOffsetRef.current.z;
          // Update matrix if structure has matrixAutoUpdate disabled
          if (!structure.matrixAutoUpdate) {
            structure.updateMatrix();
          }
        }
      } else if (editingModeRef.current) {
        // Debug: Log why dragging isn't working
        if (!isDraggingRef.current) {
          console.log('[DRAG DEBUG] isDraggingRef.current is false');
        }
        if (!selectedStructureRef.current) {
          console.log('[DRAG DEBUG] selectedStructureRef.current is null');
        }
        if (!cameraRef.current) {
          console.log('[DRAG DEBUG] cameraRef.current is null');
        }
        if (!rendererRef.current) {
          console.log('[DRAG DEBUG] rendererRef.current is null');
        }
      }
      
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

        const moveSpeed = physicsSettingsRef.current.speed * 0.06;
        const dashSpeed = moveSpeed * 4;
        const gravity = -(physicsSettingsRef.current.gravity * 0.0009);

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

  // Editing mode: Mouse handlers for structure selection and dragging
  useEffect(() => {
    console.log('[EDIT MODE] useEffect triggered, editingMode:', editingMode);
    if (!editingMode) {
      console.log('[EDIT MODE] Early return - editingMode is false');
      return;
    }
    
    console.log('[EDIT MODE] Setting up event handlers');
    
    const handleMouseMove = (e) => {
      if (!rendererRef.current) return;
      
      // Update mouse position for raycaster (always, even when dragging)
      mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
      
      // Prevent default during drag to avoid text selection
      if (isDraggingRef.current) {
        e.preventDefault();
      }
      
      // Highlight structures on hover (if not dragging)
      if (!isDraggingRef.current && sceneRef.current && cameraRef.current) {
        raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
        const intersects = raycasterRef.current.intersectObjects(structuresRef.current, true);
        
        // Remove highlight from all structures (except selected)
        structuresRef.current.forEach(struct => {
          if (struct !== selectedStructureRef.current && struct.traverse) {
            struct.traverse((child) => {
              if (child.isMesh && child.material && child.material.emissive) {
                child.material.emissive.setHex(0x000000);
              }
            });
          }
        });
        
        // Highlight hovered structure
        if (intersects.length > 0 && !isDraggingRef.current) {
          const obj = intersects[0].object;
          let structure = obj;
          while (structure.parent && !structuresRef.current.includes(structure)) {
            structure = structure.parent;
          }
          if (structuresRef.current.includes(structure) && structure !== selectedStructureRef.current) {
            structure.traverse((child) => {
              if (child.isMesh && child.material && child.material.emissive) {
                child.material.emissive.setHex(0x444444);
              }
            });
          }
        }
      }
    };
    
    const handleMouseDown = (e) => {
      console.log('[DRAG DEBUG] handleMouseDown called', {
        hasRenderer: !!rendererRef.current,
        hasCamera: !!cameraRef.current,
        hasScene: !!sceneRef.current,
        editingMode: editingMode,
        structuresCount: structuresRef.current.length
      });
      
      if (!rendererRef.current || !cameraRef.current || !sceneRef.current) return;
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.closest('button')) return;
      
      mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
      
      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
      const intersects = raycasterRef.current.intersectObjects(structuresRef.current, true);
      
      console.log('[DRAG DEBUG] Raycast intersections:', intersects.length);
      
      if (intersects.length > 0) {
        e.preventDefault();
        const obj = intersects[0].object;
        let structure = obj;
        while (structure.parent && !structuresRef.current.includes(structure)) {
          structure = structure.parent;
        }
        
        console.log('[DRAG DEBUG] Found structure:', structure, 'in structuresRef:', structuresRef.current.includes(structure));
        
        if (structuresRef.current.includes(structure)) {
          setSelectedStructure(structure);
          selectedStructureRef.current = structure;
          
          // Store original position for matching with world data
          if (!structure.userData.originalPosition) {
            structure.userData.originalPosition = {
              x: structure.position.x,
              y: structure.position.y,
              z: structure.position.z
            };
          }
          
          // Store base Y position (ground level) for scaling
          if (structure.userData.baseY === undefined) {
            structure.userData.baseY = structure.position.y;
          }
          
          // Store original scale if not already set
          if (structure.userData.originalScale === undefined) {
            structure.userData.originalScale = structure.userData.scale || structure.scale.y || 1.0;
          }
          
          // Use plane at structure's current Y position for consistent dragging
          const structureY = structure.position.y;
          const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -structureY);
          const intersectPoint = new THREE.Vector3();
          const result = raycasterRef.current.ray.intersectPlane(plane, intersectPoint);
          if (result !== null) {
            dragOffsetRef.current.set(
              structure.position.x - intersectPoint.x,
              0,
              structure.position.z - intersectPoint.z
            );
          }
          
          isDraggingRef.current = true;
          console.log('[DRAG DEBUG] Started dragging!', {
            isDragging: isDraggingRef.current,
            selectedStructure: !!selectedStructureRef.current,
            structureType: structure.userData?.structureType
          });
          
          structure.traverse((child) => {
            if (child.isMesh && child.material && child.material.emissive) {
              child.material.emissive.setHex(0x00ff00);
            }
          });
        } else {
          console.log('[DRAG DEBUG] Structure not in structuresRef.current');
        }
      } else {
        if (selectedStructureRef.current) {
          selectedStructureRef.current.traverse((child) => {
            if (child.isMesh && child.material && child.material.emissive) {
              child.material.emissive.setHex(0x000000);
            }
          });
        }
        setSelectedStructure(null);
        selectedStructureRef.current = null;
        isDraggingRef.current = false;
      }
    };
    
    const handleMouseUp = () => {
      isDraggingRef.current = false;
      
      if (selectedStructureRef.current && currentWorld) {
        const structure = selectedStructureRef.current;
        const structType = structure.userData?.structureType;
        const structures = currentWorld.structures || {};
        const newPos = {
          x: structure.position.x,
          y: structure.position.y,
          z: structure.position.z
        };
        const oldPos = structure.userData.originalPosition || newPos;
        
        // Find matching structure in world data by comparing positions (within tolerance)
        const tolerance = 0.1;
        const findMatchingStructure = (structList, targetPos) => {
          return structList.findIndex(s => {
            const pos = s.position || {};
            return Math.abs(pos.x - targetPos.x) < tolerance &&
                   Math.abs(pos.z - targetPos.z) < tolerance;
          });
        };
        
        let updated = false;
        if (structType === 'tree' && structures.trees) {
          const treeIndex = findMatchingStructure(structures.trees, oldPos);
          if (treeIndex >= 0) {
            structures.trees[treeIndex].position = newPos;
            structure.userData.originalPosition = newPos;
            updated = true;
          }
        } else if (structType === 'rock' && structures.rocks) {
          const rockIndex = findMatchingStructure(structures.rocks, oldPos);
          if (rockIndex >= 0) {
            structures.rocks[rockIndex].position = newPos;
            structure.userData.originalPosition = newPos;
            updated = true;
          }
        } else if (structType === 'building' && structures.buildings) {
          // Handle buildings (including grid-based ones)
          const buildingIndex = findMatchingStructure(structures.buildings, oldPos);
          if (buildingIndex >= 0) {
            structures.buildings[buildingIndex].position = newPos;
            structure.userData.originalPosition = newPos;
            updated = true;
          }
        }
        
        // Update placement tracking systems
        if (updated && (newPos.x !== oldPos.x || newPos.z !== oldPos.z)) {
          // Calculate structure radius based on type
          let radius = 0;
          if (structType === 'tree') {
            const scale = structure.userData.scale || 1.0;
            const leafSize = structure.userData.leafless ? 3 * scale : 2.2 * scale;
            radius = leafSize + 1;
          } else if (structType === 'rock') {
            radius = (structure.userData.scale || 1.0) * 2;
          } else if (structType === 'building') {
            radius = structure.userData.collisionRadius || 5;
          }
          
          // 1. Update occupiedCells for grid-based buildings
          // Check if old position exists in occupiedCells (indicates grid-based building)
          const oldKey = `${Math.round(oldPos.x)}:${Math.round(oldPos.z)}`;
          const newKey = `${Math.round(newPos.x)}:${Math.round(newPos.z)}`;
          if (occupiedCells.has(oldKey)) {
            occupiedCells.delete(oldKey);
            occupiedCells.add(newKey);
          }
          
          // 2. Update terrainPlacementMaskRef
          if (terrainPlacementMaskRef.current && radius > 0) {
            // Clear old position
            unmarkRadiusOccupied(oldPos.x, oldPos.z, radius, terrainPlacementMaskRef.current);
            // Mark new position as occupied
            markRadiusOccupied(newPos.x, newPos.z, radius, terrainPlacementMaskRef.current);
          }
        }
        
        if (updated) {
          // Update currentWorld state
          setCurrentWorld({ ...currentWorld });
        }
      }
    };
    
    const handleWheel = (e) => {
      if (!editingModeRef.current) return;
      if (!selectedStructureRef.current) return;
      e.preventDefault();
      
      // Scale factor: positive deltaY (scroll down) = smaller, negative (scroll up) = larger
      const scaleDelta = e.deltaY > 0 ? -0.05 : 0.05;
      // Get current scale from Three.js object scale (x, y, or z - should be uniform) or userData
      const currentScaleX = selectedStructureRef.current.scale?.x || 1.0;
      const currentScaleFromUserData = selectedStructureRef.current.userData.scale || currentScaleX;
      const currentScale = Math.max(currentScaleX, currentScaleFromUserData);
      const newScale = Math.max(0.1, Math.min(5.0, currentScale + scaleDelta));
      
      // Apply uniform scale to the structure
      selectedStructureRef.current.scale.set(newScale, newScale, newScale);
      
      // Store scale in userData for future reference
      selectedStructureRef.current.userData.scale = newScale;
      
      // Adjust Y position so the base stays on the ground
      // If structure had a base Y, keep it aligned (position changes proportionally with scale)
      const baseY = selectedStructureRef.current.userData.baseY;
      if (baseY !== undefined) {
        // Keep the bottom of the structure at the same ground level
        selectedStructureRef.current.position.y = baseY;
      }
      
      // Update matrix if structure has matrixAutoUpdate disabled
      if (!selectedStructureRef.current.matrixAutoUpdate) {
        selectedStructureRef.current.updateMatrix();
      }
      
      const structType = selectedStructureRef.current.userData?.structureType;
      const structures = currentWorld?.structures || {};
      
      // Find matching structure by position
      const tolerance = 0.1;
      const findMatchingStructure = (structList, targetPos) => {
        return structList.findIndex(s => {
          const pos = s.position || {};
          return Math.abs(pos.x - targetPos.x) < tolerance &&
                 Math.abs(pos.z - targetPos.z) < tolerance;
        });
      };
      
      let updated = false;
      if (structType === 'tree' && structures.trees) {
        const targetPos = selectedStructureRef.current.userData.originalPosition || selectedStructureRef.current.position;
        const treeIndex = findMatchingStructure(structures.trees, targetPos);
        if (treeIndex >= 0) {
          structures.trees[treeIndex].scale = newScale;
          updated = true;
        }
      } else if (structType === 'rock' && structures.rocks) {
        const targetPos = selectedStructureRef.current.userData.originalPosition || selectedStructureRef.current.position;
        const rockIndex = findMatchingStructure(structures.rocks, targetPos);
        if (rockIndex >= 0) {
          structures.rocks[rockIndex].scale = newScale;
          updated = true;
        }
      } else if (structType === 'building' && structures.buildings) {
        const targetPos = selectedStructureRef.current.userData.originalPosition || selectedStructureRef.current.position;
        const buildingIndex = findMatchingStructure(structures.buildings, targetPos);
        if (buildingIndex >= 0) {
          // Buildings might have width/height/depth instead of scale
          if (structures.buildings[buildingIndex].scale !== undefined) {
            structures.buildings[buildingIndex].scale = newScale;
          }
          updated = true;
        }
      }
      
      if (updated && currentWorld) {
        setCurrentWorld({ ...currentWorld });
      }
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [editingMode, currentWorld]);

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

  // Helper function to unmark a radius around a position (set cells back to clear/1)
  const unmarkRadiusOccupied = (x, z, radius, mask) => {
    const terrainSize = 256;
    const maskSize = mask.length;
    const radiusInCells = Math.ceil((radius / terrainSize) * maskSize);
    
    const centerRow = Math.floor((z + 128) / 256 * maskSize);
    const centerCol = Math.floor((x + 128) / 256 * maskSize);
    
    // Unmark all cells within radius (set back to 1 = clear)
    for (let dr = -radiusInCells; dr <= radiusInCells; dr++) {
      for (let dc = -radiusInCells; dc <= radiusInCells; dc++) {
        const row = centerRow + dr;
        const col = centerCol + dc;
        
        // Check bounds
        if (row < 0 || row >= maskSize || col < 0 || col >= maskSize) continue;
        
        // Check distance
        const dist = Math.sqrt(dr * dr + dc * dc);
        if (dist <= radiusInCells) {
          mask[row][col] = 1; // Mark as clear
        }
      }
    }
  };

  // Create different plant types based on biome
  const createCactus = (plantData) => {
    const group = new THREE.Group();
    const scale = plantData.scale || 1.0;
    
    // Main cactus body (tall cylinder)
    const bodyHeight = 4 * scale;
    const bodyRadius = 0.5 * scale;
    const bodyGeometry = new THREE.CylinderGeometry(bodyRadius, bodyRadius * 1.2, bodyHeight, 8);
    
    let bodyColor = 0x228B22; // Default green
    if (plantData.leaf_color) {
      if (typeof plantData.leaf_color === 'string') {
        bodyColor = parseInt(plantData.leaf_color.replace('#', ''), 16);
      } else {
        bodyColor = plantData.leaf_color;
      }
    }
    
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.8,
      flatShading: true
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = bodyHeight / 2;
    body.castShadow = true;
    group.add(body);
    
    // Add 2-3 arms (smaller cylinders)
    const armCount = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < armCount; i++) {
      const armHeight = (1.5 + Math.random() * 1) * scale;
      const armRadius = 0.3 * scale;
      const armGeometry = new THREE.CylinderGeometry(armRadius, armRadius * 1.1, armHeight, 6);
      const arm = new THREE.Mesh(armGeometry, bodyMaterial);
      
      const angle = (i / armCount) * Math.PI * 2;
      const armY = (1 + Math.random() * 2) * scale;
      arm.position.set(
        Math.cos(angle) * bodyRadius * 1.5,
        armY,
        Math.sin(angle) * bodyRadius * 1.5
      );
      arm.rotation.z = Math.random() * 0.3 - 0.15;
      arm.castShadow = true;
      group.add(arm);
    }
    
    group.matrixAutoUpdate = false;
    group.updateMatrix();
    return group;
  };

  const createCreepyPlant = (plantData) => {
    const group = new THREE.Group();
    const scale = plantData.scale || 1.0;
    
    // Twisted, dark trunk (irregular shape)
    const trunkHeight = 3.5 * scale;
    const segments = 8;
    const trunkGeometry = new THREE.CylinderGeometry(0.4 * scale, 0.5 * scale, trunkHeight, segments);
    
    // Twist the trunk vertices
    const positions = trunkGeometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i);
      const angle = (y / trunkHeight) * Math.PI * 2; // Full twist
      const radius = 0.4 * scale + Math.sin(y * 2) * 0.1 * scale;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      positions.setXYZ(i, x, y, z);
    }
    trunkGeometry.computeVertexNormals();
    
    let trunkColor = 0x2d1a1a; // Dark brown/black
    if (plantData.trunk_color) {
      if (typeof plantData.trunk_color === 'string') {
        trunkColor = parseInt(plantData.trunk_color.replace('#', ''), 16);
      } else {
        trunkColor = plantData.trunk_color;
      }
    }
    
    const trunkMaterial = new THREE.MeshStandardMaterial({
      color: trunkColor,
      roughness: 1.0,
      flatShading: true
    });
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = trunkHeight / 2;
    trunk.castShadow = true;
    group.add(trunk);
    
    // Creepy tentacle-like branches (dark, twisted)
    const branchCount = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < branchCount; i++) {
      const branchLength = (1.5 + Math.random() * 1.5) * scale;
      const branchGeometry = new THREE.CylinderGeometry(0.15 * scale, 0.2 * scale, branchLength, 6);
      
      // Twist branches
      const branchPositions = branchGeometry.attributes.position;
      for (let j = 0; j < branchPositions.count; j++) {
        const y = branchPositions.getY(j);
        const angle = (y / branchLength) * Math.PI * 3;
        const radius = 0.15 * scale;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        branchPositions.setXYZ(j, x, y, z);
      }
      branchGeometry.computeVertexNormals();
      
      const branch = new THREE.Mesh(branchGeometry, trunkMaterial);
      const angle = (i / branchCount) * Math.PI * 2;
      const branchY = (2 + Math.random() * 1.5) * scale;
      branch.position.set(
        Math.cos(angle) * 0.6 * scale,
        branchY,
        Math.sin(angle) * 0.6 * scale
      );
      branch.rotation.z = Math.random() * 0.5 - 0.25;
      branch.castShadow = true;
      group.add(branch);
    }
    
    // Dark, spiky leaves/appendages
    const spikeCount = 6;
    for (let i = 0; i < spikeCount; i++) {
      const spikeGeometry = new THREE.ConeGeometry(0.1 * scale, 0.8 * scale, 4);
      let spikeColor = 0x1a3a1a; // Dark green/black
      if (plantData.leaf_color) {
        if (typeof plantData.leaf_color === 'string') {
          spikeColor = parseInt(plantData.leaf_color.replace('#', ''), 16);
        } else {
          spikeColor = plantData.leaf_color;
        }
      }
      const spikeMaterial = new THREE.MeshStandardMaterial({
        color: spikeColor,
        roughness: 1.0,
        flatShading: true
      });
      const spike = new THREE.Mesh(spikeGeometry, spikeMaterial);
      const angle = (i / spikeCount) * Math.PI * 2;
      spike.position.set(
        Math.cos(angle) * 0.5 * scale,
        trunkHeight - 0.5 * scale,
        Math.sin(angle) * 0.5 * scale
      );
      spike.rotation.x = Math.PI / 4;
      spike.rotation.z = angle;
      spike.castShadow = true;
      group.add(spike);
    }
    
    group.matrixAutoUpdate = false;
    group.updateMatrix();
    return group;
  };

  const createTree = (treeData) => {
    const group = new THREE.Group();

    const trunkHeight = 3 * treeData.scale;
    const trunkRadius = 0.4 * treeData.scale;
    const blockHeight = 0.5 * treeData.scale;
    const blockCount = Math.floor(trunkHeight / blockHeight);

    // Use custom trunk color if provided, otherwise default
    // Convert hex string to number if needed
    let trunkColor = 0xab7354; // Default
    if (treeData.trunk_color) {
      if (typeof treeData.trunk_color === 'string') {
        trunkColor = parseInt(treeData.trunk_color.replace('#', ''), 16);
      } else {
        trunkColor = treeData.trunk_color;
      }
    }
    console.log('[CREATE TREE] Trunk color:', treeData.trunk_color, '→', trunkColor.toString(16));

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
        let leafColorValue = 0x4BBB6D; // Default
        if (treeData.leaf_color) {
          if (typeof treeData.leaf_color === 'string') {
            leafColorValue = parseInt(treeData.leaf_color.replace('#', ''), 16);
          } else {
            leafColorValue = treeData.leaf_color;
          }
        }
        console.log('[CREATE TREE] Leaf color (leafless):', treeData.leaf_color, '→', '0x' + leafColorValue.toString(16));
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
        let leafColorValue = 0x9adf8f; // Default
        if (treeData.leaf_color) {
          if (typeof treeData.leaf_color === 'string') {
            leafColorValue = parseInt(treeData.leaf_color.replace('#', ''), 16);
          } else {
            leafColorValue = treeData.leaf_color;
          }
        }
        console.log('[CREATE TREE] Leaf color (normal):', treeData.leaf_color, '→', '0x' + leafColorValue.toString(16));
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

  // Helper function to create plants based on plant_type
  const createPlant = (plantData, plantType = "tree") => {
    // Normalize plant type (handle variations)
    const normalizedType = plantType?.toLowerCase() || "tree";
    
    if (normalizedType === "cactus") {
      return createCactus(plantData);
    } else if (normalizedType === "creepy_plant" || normalizedType === "creepy") {
      return createCreepyPlant(plantData);
    } else {
      // Default: regular tree (also handles: tree, fern, vine, palm, bamboo, mushroom, crystal_plant, glowing_plant)
      // For now, all other types render as trees. Can add specific renderers later.
      return createTree(plantData);
    }
  };

  const createRock = (rockData, colorAssignments = null) => {
    const geometry = new THREE.DodecahedronGeometry(1, 0);
    // Use color from data or color_assignments if available, otherwise default
    let color = rockData.rock_color || rockData.color;
    if (!color && colorAssignments) {
      color = colorAssignments.rock || colorAssignments.mountain_dark;
    }
    if (!color) {
      color = rockData.type === 'ice_rock' ? 0xCCE5FF : 0x808080;
    }
    // Convert hex string to number if needed
    if (typeof color === 'string') {
      color = parseInt(color.replace('#', ''), 16);
    }
    const material = new THREE.MeshStandardMaterial({ 
      color: color, 
      roughness: 0.8,
      metalness: 0.2
    });
    const rock = new THREE.Mesh(geometry, material);
    // Always use terrain height to ensure rocks are placed on terrain (not floating)
    const terrainY = getHeightAt(rockData.position.x, rockData.position.z);
    const finalY = terrainY + 0.5; // Place rock on top of terrain (0.5 unit offset for radius)
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

  // Create room walls and floor for indoor biome
  const createRoomWall = (wallData) => {
    const { dimensions, position, color, type, transparent, opacity } = wallData;
    
    const geometry = new THREE.BoxGeometry(
      dimensions.width,
      dimensions.height,
      dimensions.depth
    );
    
    let wallColor = color || '#E8E8E8';
    if (typeof wallColor === 'string' && wallColor.startsWith('#')) {
      wallColor = parseInt(wallColor.replace('#', ''), 16);
    } else if (typeof wallColor === 'number') {
      // Already a hex number
    } else {
      wallColor = 0xE8E8E8; // Default gray
    }
    
    const material = new THREE.MeshStandardMaterial({
      color: wallColor,
      roughness: type === 'floor' ? 0.9 : 0.7,
      metalness: 0.1,
      side: THREE.DoubleSide,
      transparent: transparent || false,
      opacity: opacity !== undefined ? opacity : 1.0
    });
    
    const wall = new THREE.Mesh(geometry, material);
    wall.position.set(position.x, position.y, position.z);
    wall.receiveShadow = true;
    wall.castShadow = type !== 'floor' && !transparent;
    
    return wall;
  };

  // Create scanned objects (coffee maker, paper towel, etc.)
  const createScannedObject = (objData) => {
    const group = new THREE.Group();
    const { parts, position, scale, rotation, name, type, model_url } = objData;
    
    // Check if this is a GLB model from Tripo3D (Priority 1)
    if (type === 'glb_model' && model_url) {
      console.log(`[GLB] Loading Tripo3D model for '${name}': ${model_url}`);
      
      // Create placeholder box while loading
      const placeholderGeometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
      const placeholderMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x4A90E2,
        transparent: true,
        opacity: 0.5,
        wireframe: true
      });
      const placeholder = new THREE.Mesh(placeholderGeometry, placeholderMaterial);
      placeholder.position.y = 0.25;
      group.add(placeholder);
      
      // Mark group as loading
      group.userData.isLoading = true;
      group.userData.modelUrl = model_url;
      
      // Load GLB model asynchronously
      const loader = new GLTFLoader();
      loader.load(
        model_url,
        (gltf) => {
          // Success! Replace placeholder with actual model
          console.log(`[GLB] ✅ Model loaded successfully for '${name}'`);
          
          // Remove placeholder
          group.remove(placeholder);
          
          // Add loaded model
          const model = gltf.scene;
          
          // Enable shadows for all meshes
          model.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          
          // Scale model to reasonable size (Tripo3D models vary in size)
          const bbox = new THREE.Box3().setFromObject(model);
          const size = bbox.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          
          // Scale to approximately 1-2 units max dimension
          if (maxDim > 0) {
            const targetSize = 1.5;
            const scaleAdjust = targetSize / maxDim;
            model.scale.setScalar(scaleAdjust);
          }
          
          // Center the model at origin
          const center = bbox.getCenter(new THREE.Vector3());
          model.position.sub(center.multiplyScalar(model.scale.x));
          
          // Ensure model sits on ground (y=0)
          const newBbox = new THREE.Box3().setFromObject(model);
          const minY = newBbox.min.y;
          model.position.y -= minY;
          
          group.add(model);
          group.userData.isLoading = false;
          group.userData.modelLoaded = true;
        },
        (progress) => {
          // Loading progress
          if (progress.total > 0) {
            const percent = (progress.loaded / progress.total * 100).toFixed(0);
            if (percent % 25 === 0) {  // Log every 25%
              console.log(`[GLB] Loading '${name}': ${percent}%`);
            }
          }
        },
        (error) => {
          // Error loading model - fall back to placeholder
          console.error(`[GLB] ❌ Failed to load model for '${name}':`, error);
          console.log(`[GLB] Keeping placeholder box for '${name}'`);
          
          // Make placeholder solid and colored
          placeholderMaterial.opacity = 1.0;
          placeholderMaterial.wireframe = false;
          placeholderMaterial.color.setHex(0x808080);
          
          group.userData.isLoading = false;
          group.userData.loadFailed = true;
        }
      );
    }
    // Standard primitive shapes (Priority 2/3)
    else if (parts && Array.isArray(parts)) {
      parts.forEach(part => {
        let geometry;
        let partColor = part.color || '#808080';
        if (typeof partColor === 'string') {
          partColor = parseInt(partColor.replace('#', ''), 16);
        }
        
        const material = new THREE.MeshStandardMaterial({
          color: partColor,
          roughness: 0.6,
          metalness: 0.2
        });
        
        switch (part.shape) {
          case 'box':
            geometry = new THREE.BoxGeometry(
              part.dimensions?.width || 1,
              part.dimensions?.height || 1,
              part.dimensions?.depth || 1
            );
            break;
          case 'cylinder':
            geometry = new THREE.CylinderGeometry(
              part.radius || 0.5,
              part.radius || 0.5,
              part.height || 1,
              16
            );
            break;
          case 'sphere':
            geometry = new THREE.SphereGeometry(part.radius || 0.5, 16, 16);
            break;
          case 'cone':
            geometry = new THREE.ConeGeometry(part.radius || 0.5, part.height || 1, 16);
            break;
          default:
            geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        }
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(
          part.position?.x || 0,
          part.position?.y || 0,
          part.position?.z || 0
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      });
    } else {
      // Fallback: create a simple box (Priority 4)
      const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
      const material = new THREE.MeshStandardMaterial({ color: 0x808080 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = 0.25;
      group.add(mesh);
    }
    
    // Position and rotate the group
    group.position.set(position?.x || 0, position?.y || 0, position?.z || 0);
    if (scale && type !== 'glb_model') {
      // Don't apply scale to GLB models (they handle their own scaling)
      group.scale.setScalar(scale);
    }
    if (rotation) group.rotation.y = rotation;
    
    // Add label for debugging
    group.name = name || 'scanned_object';
    
    return group;
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
      color: 0xD2B48C,  // Beige color
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

  const addRoadsToColorMap = (colorMapArray, terrainSize, buildingDataArray = []) => {
    // Road color: beige (sand/tan color)
    const roadColor = [210, 180, 140]; // Beige RGB
    const roadWidth = 5; // Road width in world units (natural connecting paths)
    
    // Convert world position to terrain array index
    const worldToIndex = (worldPos, terrainSize, arraySize) => {
      const normalizedX = (worldPos + terrainSize / 2) / terrainSize;
      const normalizedZ = (worldPos + terrainSize / 2) / terrainSize;
      const col = Math.floor(normalizedX * (arraySize - 1));
      const row = Math.floor(normalizedZ * (arraySize - 1));
      return { row: Math.max(0, Math.min(arraySize - 1, row)), col: Math.max(0, Math.min(arraySize - 1, col)) };
    };
    
    const drawRoadSegment = (startX, startZ, endX, endZ) => {
      const startIdx = worldToIndex(startX, terrainSize, colorMapArray.length);
      const endIdx = worldToIndex(endX, terrainSize, colorMapArray.length);
      const startZIdx = worldToIndex(startZ, terrainSize, colorMapArray.length);
      const endZIdx = worldToIndex(endZ, terrainSize, colorMapArray.length);
      
      // Draw horizontal road segment
      if (Math.abs(startZIdx.row - endZIdx.row) < 2) {
        const row = startZIdx.row;
        const minCol = Math.min(startIdx.col, endIdx.col);
        const maxCol = Math.max(startIdx.col, endIdx.col);
        for (let col = minCol; col <= maxCol; col++) {
          for (let offset = -roadWidth; offset <= roadWidth; offset++) {
            const r = Math.max(0, Math.min(colorMapArray.length - 1, row + offset));
            const c = Math.max(0, Math.min(colorMapArray.length - 1, col));
            if (colorMapArray[r] && colorMapArray[r][c]) {
              colorMapArray[r][c] = [...roadColor];
            }
          }
        }
      }
      
      // Draw vertical road segment
      if (Math.abs(startIdx.col - endIdx.col) < 2) {
        const col = startIdx.col;
        const minRow = Math.min(startZIdx.row, endZIdx.row);
        const maxRow = Math.max(startZIdx.row, endZIdx.row);
        for (let row = minRow; row <= maxRow; row++) {
          for (let offset = -roadWidth; offset <= roadWidth; offset++) {
            const r = Math.max(0, Math.min(colorMapArray.length - 1, row));
            const c = Math.max(0, Math.min(colorMapArray.length - 1, col + offset));
            if (colorMapArray[r] && colorMapArray[r][c]) {
              colorMapArray[r][c] = [...roadColor];
            }
          }
        }
      }
    };
    
    const arraySize = colorMapArray.length;
    
    // Collect all grid building positions
    const gridBuildings = [];
    buildingDataArray.forEach((buildingData, idx) => {
      const gridIndex = Math.floor(idx / (buildingGridConfig.gridSizeX * buildingGridConfig.gridSizeZ));
      const localIndex = idx % (buildingGridConfig.gridSizeX * buildingGridConfig.gridSizeZ);
      
      if (gridIndex < buildingGridOrigins.length) {
        const gridOrigin = buildingGridOrigins[gridIndex];
        const gridPos = getBuildingGridPosition(localIndex, buildingGridConfig, gridOrigin);
        gridBuildings.push({
          x: gridPos.x,
          z: gridPos.z,
          row: Math.floor(localIndex / buildingGridConfig.gridSizeX),
          col: localIndex % buildingGridConfig.gridSizeX,
          gridIndex,
          idx
        });
      }
    });
    
    // Draw natural connecting roads - just one side (south side) connecting buildings
    gridBuildings.forEach((building) => {
      const buildingData = buildingDataArray[building.idx];
      const buildingWidth = (buildingData?.width || 4) * 2;
      const buildingDepth = (buildingData?.depth || 4) * 2;
      
      // Draw road on south side (front) of building
      const roadStartX = building.x - buildingWidth / 2 - roadWidth;
      const roadEndX = building.x + buildingWidth / 2 + roadWidth;
      const roadZ = building.z + buildingDepth / 2 + roadWidth;
      
      drawRoadSegment(roadStartX, roadZ, roadEndX, roadZ);
      
      // Connect to next building in same row (if exists)
      const nextBuilding = gridBuildings.find(b => 
        b.gridIndex === building.gridIndex && 
        b.row === building.row && 
        b.col === building.col + 1
      );
      
      if (nextBuilding) {
        const nextData = buildingDataArray[nextBuilding.idx];
        const nextWidth = (nextData?.width || 4) * 2;
        const nextDepth = (nextData?.depth || 4) * 2;
        const connectStartX = building.x + buildingWidth / 2 + roadWidth;
        const connectEndX = nextBuilding.x - nextWidth / 2 - roadWidth;
        const connectZ = building.z + buildingDepth / 2 + roadWidth;
        drawRoadSegment(connectStartX, connectZ, connectEndX, connectZ);
      }
    });
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

    // Use color from buildingData, color_assignments from currentWorld or data, or default to city colors
    let color = buildingData.building_color || buildingData.color;
    // Try color_assignments from currentWorld first (if state is updated)
    let assignments = currentWorld?.world?.color_assignments;
    // If not available, try to get from buildingData if passed directly
    if (!assignments && buildingData._color_assignments) {
      assignments = buildingData._color_assignments;
    }
    if (!color && assignments) {
      // Use building color, or variants if available
      color = assignments.building || assignments.building_light || assignments.building_dark;
    }
    if (!color) {
      // City building colors - light pink and light blue pastels (from second image)
      const cityColors = [
        0xFFB6C1,  // Light pink (bright light hitting surface)
        0xFFC0CB,  // Pink
        0xFFD1DC,  // Very light pink
        0xB0E0E6,  // Powder blue
        0xADD8E6,  // Light blue
        0xE0F6FF,  // Very light blue
        0xFFE4E1,  // Misty rose (pink-white)
        0xF0F8FF   // Alice blue (very light blue)
      ];
      color = cityColors[Math.floor(Math.random() * cityColors.length)];
    }
    // Convert hex string to number if needed
    if (typeof color === 'string') {
      color = parseInt(color.replace('#', ''), 16);
    }

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
      // For pastel colors, make them even lighter and brighter (light pink where bright light hits)
      const lighter = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.5); // More white blend for bright surfaces
      const darker = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.1); // Very subtle darkening, still light

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

      /* ---------- BUSHES AROUND BASE ---------- */
      const bushGroup = new THREE.Group();
      const bushCount = 8; // Number of bushes around the perimeter
      const baseWidth = width * 1.2;
      const baseDepth = depth * 1.2;
      const bushSize = Math.min(baseWidth, baseDepth) * 0.15; // Bush size relative to base
      const bushHeight = bushSize * 0.6;
      
      // Green colors for bushes - match tree green shade
      // Default tree greens: 0x4BBB6D (leafless) and 0x9adf8f (normal), use similar shades
      const bushColors = [0x4BBB6D, 0x9adf8f, 0x7BC87A, 0x5BCF6B]; // Match tree green shades
      
      for (let i = 0; i < bushCount; i++) {
        const angle = (i / bushCount) * Math.PI * 2;
        // Position bushes around the perimeter of the base, with spacing so they don't touch
        const baseRadius = Math.max(baseWidth, baseDepth) / 2;
        const spacing = bushSize * 1.5; // Space between bush edge and building edge
        const radius = baseRadius + spacing + bushSize / 2; // Position bush center outside building
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        
        // Create a low-poly bush using a sphere
        const bushGeom = new THREE.SphereGeometry(bushSize, 6, 4);
        bushGeom.scale(1, 0.6, 1); // Flatten slightly
        const bushColor = bushColors[Math.floor(Math.random() * bushColors.length)];
        const bushMat = new THREE.MeshStandardMaterial({
          color: bushColor,
          roughness: 0.9,
          metalness: 0.0
        });
        const bush = new THREE.Mesh(bushGeom, bushMat);
        bush.position.set(x, bushHeight / 2, z); // Position at ground level
        bush.castShadow = true;
        bush.receiveShadow = true;
        bush.matrixAutoUpdate = false;
        bush.updateMatrix();
        bushGroup.add(bush);
      }
      
      bushGroup.matrixAutoUpdate = false;
      bushGroup.updateMatrix();
      group.add(bushGroup);

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

      // City house colors - specific palette
      const houseColors = [
        0x687FE5,  // Blue
        0xFEEBF6,  // Pink
        0xFCD8CD   // Peach/pink
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

  const createMountainPeak = (peakData, biome = null) => {
  const group = new THREE.Group();
  const baseHeight = 80;
  const isArctic = biome && (biome.toLowerCase() === 'arctic' || biome.toLowerCase() === 'winter' || biome.toLowerCase() === 'icy' || biome.toLowerCase() === 'snow' || biome.toLowerCase() === 'frozen');
  
  // Create main mountain with more detailed geometry for jagged peaks
  const mainGeometry = new THREE.ConeGeometry(40, baseHeight, 16, 1); // Increased segments for more detail
  const positions = mainGeometry.attributes.position;
  
  // Create jagged, sharp peaks with aggressive vertex displacement
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    
    // Don't modify base vertices
    if (y > -baseHeight / 2 + 5) {
      // More aggressive displacement for jagged peaks
      const displacement = (Math.random() - 0.5) * 15;
      const heightFactor = Math.pow((y + baseHeight / 2) / baseHeight, 1.5); // Non-linear for sharper peaks
      
      // More displacement near the peak for dramatic effect
      const scaledDisplacement = displacement * heightFactor;
      
      positions.setX(i, x + scaledDisplacement * 1.2);
      positions.setZ(i, z + scaledDisplacement * 1.2);
      positions.setY(i, y + scaledDisplacement * 0.5);
    }
  }
  
  mainGeometry.computeVertexNormals();
  
  // Calculate normals for slope-based coloring
  const normals = mainGeometry.attributes.normal;
  
  // Create realistic colors: white snow at top/gentle slopes, dark rock on steep faces
  const colors = [];
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i);
    const heightRatio = (y + baseHeight / 2) / baseHeight;
    
    // Get surface normal for slope calculation
    const nx = normals.getX(i);
    const ny = normals.getY(i);
    const nz = normals.getZ(i);
    const slope = Math.acos(Math.max(0, Math.min(1, ny))); // Angle from vertical (0 = flat, PI/2 = vertical)
    
    // Always apply snow-capped peaks on top portion of mountains
    const isSteep = slope > Math.PI / 4; // Steep faces (45+ degrees)
    const isHigh = heightRatio > 0.5; // Upper 50% of mountain gets snow
    
    if (isHigh) {
      // Snow at high altitudes: bright white with slight blue tint in shadows
      const snowBrightness = 0.95 + heightRatio * 0.05;
      const blueTint = 0.08 + (1 - ny) * 0.12; // More blue on vertical faces (shadows)
      colors.push(snowBrightness, snowBrightness, snowBrightness + blueTint);
    } else if (isSteep) {
      // Exposed dark rock on steep lower faces
      const rockDarkness = 0.3 + (1 - heightRatio) * 0.2;
      colors.push(rockDarkness, rockDarkness, rockDarkness + 0.05);
    } else {
      // Lower gentle slopes: transition from snow to rock
      const transition = heightRatio * 2; // 0 to 1 in lower half
      const snowBrightness = 0.85 + transition * 0.1;
      const rockDarkness = 0.4 + (1 - transition) * 0.15;
      const r = snowBrightness * transition + rockDarkness * (1 - transition);
      const g = r;
      const b = r + 0.05 * transition;
      colors.push(r, g, b);
    }
  }
  
  mainGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  
  // Enhanced material for realistic snow/rock appearance
    const material = new THREE.MeshStandardMaterial({ 
    vertexColors: true,
    roughness: 0.85, // Snow is slightly less rough
    metalness: 0.05,
    flatShading: false, // Smooth shading for better lighting
    envMapIntensity: 0.3
  });
  
  const mainPeak = new THREE.Mesh(mainGeometry, material);
  mainPeak.castShadow = true;
  mainPeak.receiveShadow = true;
  group.add(mainPeak);
  
  // Add 2-4 smaller jagged sub-peaks for complexity
  const subPeakCount = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < subPeakCount; i++) {
    const subHeight = baseHeight * (0.35 + Math.random() * 0.4);
    const subRadius = 12 + Math.random() * 18;
    const subGeometry = new THREE.ConeGeometry(subRadius, subHeight, 12, 1); // More segments
    const subPositions = subGeometry.attributes.position;
    
    // Randomize sub-peak vertices for jagged appearance
    for (let j = 0; j < subPositions.count; j++) {
      const x = subPositions.getX(j);
      const y = subPositions.getY(j);
      const z = subPositions.getZ(j);
      
      if (y > -subHeight / 2 + 3) {
        const displacement = (Math.random() - 0.5) * 12;
        const heightFactor = Math.pow((y + subHeight / 2) / subHeight, 1.5);
        const scaledDisplacement = displacement * heightFactor;
        
        subPositions.setX(j, x + scaledDisplacement * 1.0);
        subPositions.setZ(j, z + scaledDisplacement * 1.0);
        subPositions.setY(j, y + scaledDisplacement * 0.4);
      }
    }
    
    subGeometry.computeVertexNormals();
    const subNormals = subGeometry.attributes.normal;
    
    // Color sub-peaks with same logic - always snow-capped
    const subColors = [];
    for (let j = 0; j < subPositions.count; j++) {
      const y = subPositions.getY(j);
      const heightRatio = (y + subHeight / 2) / subHeight;
      const ny = subNormals.getY(j);
      const slope = Math.acos(Math.max(0, Math.min(1, ny)));
      
      const isSteep = slope > Math.PI / 4;
      const isHigh = heightRatio > 0.5;
      
      if (isHigh) {
        // Snow at high altitudes
        const snowBrightness = 0.95 + heightRatio * 0.05;
        const blueTint = 0.08 + (1 - ny) * 0.12;
        subColors.push(snowBrightness, snowBrightness, snowBrightness + blueTint);
      } else if (isSteep) {
        // Exposed dark rock on steep lower faces
        const rockDarkness = 0.3 + (1 - heightRatio) * 0.2;
        subColors.push(rockDarkness, rockDarkness, rockDarkness + 0.05);
      } else {
        // Lower gentle slopes: transition from snow to rock
        const transition = heightRatio * 2;
        const snowBrightness = 0.85 + transition * 0.1;
        const rockDarkness = 0.4 + (1 - transition) * 0.15;
        const r = snowBrightness * transition + rockDarkness * (1 - transition);
        const g = r;
        const b = r + 0.05 * transition;
        subColors.push(r, g, b);
      }
    }
    
    subGeometry.setAttribute('color', new THREE.Float32BufferAttribute(subColors, 3));
    
    const subPeak = new THREE.Mesh(subGeometry, material.clone());
    subPeak.castShadow = true;
    subPeak.receiveShadow = true;
    
    // Position sub-peaks around main peak
    const angle = (i / subPeakCount) * Math.PI * 2 + Math.random() * 0.5;
    const distance = 18 + Math.random() * 20;
    subPeak.position.set(
      Math.cos(angle) * distance,
      baseHeight * 0.1,
      Math.sin(angle) * distance
    );
    subPeak.rotation.y = Math.random() * Math.PI * 2;
    
    group.add(subPeak);
  }
  
  // Position the entire mountain group
  const terrainY = getHeightAt(peakData.position.x, peakData.position.z);
  const scaledHeight = baseHeight * peakData.scale;
  group.position.set(
      peakData.position.x,
    terrainY + scaledHeight / 2,
      peakData.position.z
    );
  group.scale.setScalar(peakData.scale);
  group.rotation.y = Math.random() * Math.PI * 2;
  
  return group;
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

  const placeLebronImageOnTerrain = () => {
    const scene = sceneRef.current;
    if (!scene) {
      console.error('[LEBRON] Scene not available');
      return;
    }

    // Remove existing LeBron image if it exists
    if (lebronBillboardRef.current) {
      scene.remove(lebronBillboardRef.current);
      if (lebronBillboardRef.current.geometry) lebronBillboardRef.current.geometry.dispose();
      if (lebronBillboardRef.current.material) lebronBillboardRef.current.material.dispose();
      lebronBillboardRef.current = null;
    }

    // Load texture
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
      '/lebron-james.jpg',
      (texture) => {
        if (!playerRef.current) {
          console.error('[LEBRON] Player not available');
          return;
        }

        const player = playerRef.current;
        const playerPosition = player.position;
        
        // Player size: SphereGeometry with radius 1, scaled (1, 1, 1.4)
        // Roughly 1 unit radius, 1.4 units tall = ~2.8 units total height
        const playerSize = 2.8; // Approximate player height
        const imageSize = playerSize * 10; // 10 times larger than player
        
        // Get camera direction (player's forward direction)
        const camera = cameraRef.current;
        let forward = new THREE.Vector3(0, 0, -1); // Default forward
        
        if (camera) {
          // Get camera's forward direction
          camera.getWorldDirection(forward);
          forward.y = 0; // Keep horizontal (don't tilt up/down)
          forward.normalize();
        }
        
        // Position image in front of player (20 units in front)
        const distanceInFront = 20;
        const imageX = playerPosition.x + forward.x * distanceInFront;
        const imageZ = playerPosition.z + forward.z * distanceInFront;
        
        // Calculate image dimensions maintaining aspect ratio
        const aspectRatio = texture.image.height / texture.image.width;
        const imageWidth = imageSize;
        const imageHeight = imageSize * aspectRatio;
        
        const geometry = new THREE.PlaneGeometry(imageWidth, imageHeight);
        const material = new THREE.MeshStandardMaterial({
          map: texture,
          transparent: true,
          side: THREE.DoubleSide
        });
        
        const billboard = new THREE.Mesh(geometry, material);
        billboard.userData.isLebronBillboard = true;
        
        // Position on terrain at the calculated position
        const terrainY = getHeightAt(imageX, imageZ);
        billboard.position.set(imageX, terrainY + imageHeight / 2, imageZ);
        
        // Make it face the player
        billboard.lookAt(playerPosition);
        
        scene.add(billboard);
        lebronBillboardRef.current = billboard;
        console.log('[LEBRON] Image placed on terrain at:', billboard.position);
      },
      undefined,
      (error) => {
        console.error('[LEBRON] Error loading image:', error);
      }
    );
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
    const combMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
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

    // Set position using terrain height
    if (position) {
      const terrainY = getHeightAt(position.x || 0, position.z || 0);
      const finalY = terrainY + 1; // Place enemy on top of terrain (1 unit offset)
      group.position.set(position.x || 0, finalY, position.z || 0);
    }

    return group;
  };

  const createCreativeObject = (objData) => {
    /**
     * Creates a creative object from Claude's description.
     * objData should have: name, position, rotation (optional), scale (optional), parts[]
     * Each part has: shape, position, rotation (optional), dimensions/radius, color, material (optional)
     */
    const group = new THREE.Group();
    const baseScale = objData.scale || 1.0;
    const basePos = objData.position || { x: 0, y: 0, z: 0 };
    const baseRot = objData.rotation || { x: 0, y: 0, z: 0 };

    // Set base position and rotation
    group.position.set(basePos.x, basePos.y, basePos.z);
    group.rotation.set(baseRot.x, baseRot.y, baseRot.z);

    // Create each part
    objData.parts.forEach((part, index) => {
      let geometry;
      const partScale = baseScale;
      const partPos = part.position || { x: 0, y: 0, z: 0 };
      const partRot = part.rotation || { x: 0, y: 0, z: 0 };
      
      // Parse color
      const colorHex = typeof part.color === 'string' 
        ? parseInt(part.color.replace('#', ''), 16) 
        : (part.color || 0x888888);
      
      // Create material
      const materialProps = part.material || { roughness: 0.7, metalness: 0.1 };
      const material = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: materialProps.roughness || 0.7,
        metalness: materialProps.metalness || 0.1,
        emissive: materialProps.emissive ? new THREE.Color(materialProps.emissive) : 0x000000,
        emissiveIntensity: materialProps.emissiveIntensity || 0
      });

      // Create geometry based on shape type
      switch (part.shape.toLowerCase()) {
        case 'box':
          const dims = part.dimensions || { width: 1, height: 1, depth: 1 };
          geometry = new THREE.BoxGeometry(
            dims.width * partScale,
            dims.height * partScale,
            dims.depth * partScale
          );
          break;
        
        case 'cylinder':
          const cylRadius = (part.radius || 0.5) * partScale;
          const cylHeight = (part.height || 1.0) * partScale;
          const cylSegments = part.segments || 16;
          geometry = new THREE.CylinderGeometry(cylRadius, cylRadius, cylHeight, cylSegments);
          break;
        
        case 'sphere':
          const sphereRadius = (part.radius || 0.5) * partScale;
          const sphereSegments = part.segments || 16;
          geometry = new THREE.SphereGeometry(sphereRadius, sphereSegments, sphereSegments);
          break;
        
        case 'cone':
          const coneRadius = (part.radius || 0.5) * partScale;
          const coneHeight = (part.height || 1.0) * partScale;
          const coneSegments = part.segments || 16;
          geometry = new THREE.ConeGeometry(coneRadius, coneHeight, coneSegments);
          break;
        
        case 'torus':
          const torusRadius = (part.radius || 0.5) * partScale;
          const torusTube = (part.tube || 0.2) * partScale;
          const torusSegments = part.segments || 16;
          const torusArc = part.arc || Math.PI * 2;
          geometry = new THREE.TorusGeometry(torusRadius, torusTube, torusSegments, 16, torusArc);
          break;
        
        default:
          console.warn(`Unknown shape type: ${part.shape}, defaulting to box`);
          geometry = new THREE.BoxGeometry(1 * partScale, 1 * partScale, 1 * partScale);
      }

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(partPos.x * partScale, partPos.y * partScale, partPos.z * partScale);
      mesh.rotation.set(partRot.x, partRot.y, partRot.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      
      group.add(mesh);
    });

    // Calculate terrain height at position
    const terrainY = getHeightAt(basePos.x, basePos.z);
    group.position.y = terrainY + basePos.y;

    group.userData = {
      structureType: 'creative_object',
      name: objData.name || 'creative_object',
      originalData: objData,
      detailedModel: objData.detailed_model || false,
      modelLoading: false,
      modelLoaded: false
    };

    // If detailed_model is requested, try to load it
    if (objData.detailed_model) {
      loadDetailedModel(group, objData);
    }

    return group;
  };

  const loadDetailedModel = async (group, objData) => {
    /**
     * Loads a detailed 3D model for a creative object.
     * First checks cache, then requests generation if needed.
     */
    group.userData.modelLoading = true;
    
    try {
      // Check if model exists in cache
      const cacheKey = objData.name?.toLowerCase().replace(/\s+/g, '_') || 'unknown';
      const modelUrl = `http://localhost:8000/assets/models_cache/${cacheKey}.glb`;
      
      // Try to load from cache first
      const loader = new GLTFLoader();
      
      loader.load(
        modelUrl,
        (gltf) => {
          // Model loaded successfully - replace basic shapes with detailed model
          const detailedModel = gltf.scene;
          detailedModel.scale.setScalar(objData.scale || 1.0);
          
          // Enhance materials and colors for better appearance
          detailedModel.traverse((child) => {
            if (child.isMesh) {
              // Enhance existing materials
              if (child.material) {
                // If material is an array, process each one
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                
                materials.forEach((material) => {
                  // Enhance material properties for better appearance
                  if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) {
                    // Improve lighting and color
                    material.roughness = Math.min(material.roughness || 0.7, 0.8);
                    material.metalness = Math.max(material.metalness || 0.1, 0.0);
                    
                    // Enhance color saturation if color exists
                    if (material.color) {
                      const hsl = {};
                      material.color.getHSL(hsl);
                      // Increase saturation slightly for more vibrant colors
                      hsl.s = Math.min(hsl.s * 1.2, 1.0);
                      // Ensure minimum lightness for visibility
                      hsl.l = Math.max(hsl.l, 0.3);
                      material.color.setHSL(hsl.h, hsl.s, hsl.l);
                    }
                    
                    // Ensure shadows work properly
                    material.needsUpdate = true;
                  }
                  
                  // If no color/texture, apply a default color based on object name
                  if (!material.map && !material.color || material.color.getHex() === 0xffffff) {
                    const defaultColor = getDefaultColorForObject(objData.name);
                    material.color = new THREE.Color(defaultColor);
                    material.needsUpdate = true;
                  }
                });
                
                // Update child material reference
                if (!Array.isArray(child.material)) {
                  child.material = materials[0];
                }
              }
              
              // Ensure shadows
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          
          // Remove basic shape parts
          while (group.children.length > 0) {
            group.remove(group.children[0]);
          }
          
          // Add detailed model
          group.add(detailedModel);
          group.userData.modelLoaded = true;
          group.userData.modelLoading = false;
          
          console.log(`[Creative Object] Loaded detailed model for: ${objData.name}`);
        },
        (progress) => {
          // Loading progress
          console.log(`[Creative Object] Loading model for ${objData.name}: ${(progress.loaded / progress.total * 100).toFixed(1)}%`);
        },
        (error) => {
          // Model not in cache - request generation (but keep basic shapes for now)
          console.log(`[Creative Object] Model not cached for ${objData.name}, requesting generation...`);
          requestModelGeneration(objData.name, objData.description || objData.name);
          group.userData.modelLoading = false;
        }
      );
    } catch (error) {
      console.error(`[Creative Object] Error loading detailed model:`, error);
      group.userData.modelLoading = false;
    }
  };

  const requestModelGeneration = async (objectName, description) => {
    /**
     * Requests generation of a detailed 3D model.
     * This happens in the background - basic shapes remain visible.
     */
    try {
      const response = await fetch('http://localhost:8000/api/generate-model', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          object_name: objectName,
          description: description,
          force_regenerate: false
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log(`[Creative Object] Model generation requested for: ${objectName}`, result);
        
        // Poll for model completion
        if (result.status === 'generating') {
          pollModelStatus(result.cache_key, objectName);
        }
      } else {
        const error = await response.json();
        console.log(`[Creative Object] Model generation not available: ${error.detail}`);
        // Model generation API not integrated - basic shapes will remain
      }
    } catch (error) {
      console.error(`[Creative Object] Error requesting model generation:`, error);
    }
  };

  const getDefaultColorForObject = (objectName) => {
    /**
     * Returns a default color based on object name/type.
     * Used when Replicate models don't have good colors.
     */
    const name = objectName.toLowerCase();
    
    // Furniture colors
    if (name.includes('chair') || name.includes('seat')) return 0x8B4513; // Brown wood
    if (name.includes('table') || name.includes('desk')) return 0xD2691E; // Chocolate
    if (name.includes('bench')) return 0x654321; // Dark brown
    
    // Statues/monuments
    if (name.includes('statue') || name.includes('monument')) return 0xC0C0C0; // Silver
    if (name.includes('liberty')) return 0x87CEEB; // Sky blue (Statue of Liberty)
    
    // Vehicles
    if (name.includes('car') || name.includes('vehicle')) return 0xFF0000; // Red
    if (name.includes('truck')) return 0x0000FF; // Blue
    
    // Decorative
    if (name.includes('fountain')) return 0x4682B4; // Steel blue
    if (name.includes('lamp') || name.includes('light')) return 0xFFD700; // Gold
    
    // Default: neutral gray with slight color tint
    return 0x888888;
  };

  const pollModelStatus = async (cacheKey, objectName) => {
    /**
     * Polls for model generation status and loads when ready.
     */
    const maxAttempts = 60; // 60 attempts = 1 minute (poll every second)
    let attempts = 0;
    
    const poll = async () => {
      try {
        const response = await fetch(`http://localhost:8000/api/model-status/${cacheKey}`);
        const status = await response.json();
        
        if (status.status === 'ready' && status.model_url) {
          // Model is ready - find the object and reload it
          const creativeObjects = structuresRef.current.filter(
            obj => obj.userData?.structureType === 'creative_object' && 
                   obj.userData?.name === objectName &&
                   !obj.userData?.modelLoaded
          );
          
          creativeObjects.forEach(obj => {
            const objData = obj.userData.originalData;
            loadDetailedModel(obj, objData);
          });
        } else if (attempts < maxAttempts) {
          attempts++;
          setTimeout(poll, 1000); // Poll every second
        }
      } catch (error) {
        console.error(`[Creative Object] Error polling model status:`, error);
      }
    };
    
    setTimeout(poll, 1000); // Start polling after 1 second
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

  const createCloud = (x, y, z, scale = 1, biomeName = null) => {
    const cloudGroup = new THREE.Group();
    
    // More boxes for fluffier clouds
    const boxCount = 5 + Math.floor(Math.random() * 4); // 5-8 boxes
    
    for (let i = 0; i < boxCount; i++) {
      // More variation in size
      const width = (4 + Math.random() * 6) * scale;
      const height = (2 + Math.random() * 3) * scale;
      const depth = (3 + Math.random() * 5) * scale;

      const geometry = new THREE.BoxGeometry(width, height, depth);
      
      // Cloud color based on biome
      let material;
      if (biomeName && biomeName.toLowerCase() === 'city') {
        // White clouds with slight pinkish tint for city at noon
        const brightness = 0.98 + Math.random() * 0.02;
        const pinkTint = 0.95 + Math.random() * 0.05; // Slight pinkish tint
        material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(brightness, pinkTint, brightness),
        });
      } else {
        // Standard white clouds for other biomes
      const brightness = 0.95 + Math.random() * 0.05;
        material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(brightness, brightness, brightness),
      });
      }

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

  const createNorthernLights = (scene) => {
  console.log('[NORTHERN LIGHTS] Creating aurora borealis...');
  
  // Remove any existing northern lights
  const existingLights = scene.children.filter(c => c.userData?.isNorthernLights);
  existingLights.forEach(light => scene.remove(light));
  
  // Create multiple layers of northern lights for depth - matching reference image
  const layers = [];
  const layerCount = 6; // More layers for richer depth like reference
  
  for (let layer = 0; layer < layerCount; layer++) {
    // Create geometry for the aurora curtain - very large to match reference sky coverage
    const width = 1000; // Even wider to cover more sky
    const height = 200; // Taller for dramatic effect
    const segments = 80; // More segments for smoother, flowing curves
    
    const geometry = new THREE.PlaneGeometry(width, height, segments, segments);
    
    // Animate the vertices to create wave effect
    const positions = geometry.attributes.position;
    const time = Date.now() * 0.001;
    
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      
      // Create flowing wave pattern with more variation
      const wave1 = Math.sin(x * 0.008 + time + layer) * 8;
      const wave2 = Math.sin(x * 0.015 - time * 0.7 + layer * 0.5) * 5;
      const wave3 = Math.cos(y * 0.04 + time * 0.4) * 3;
      const wave4 = Math.sin(x * 0.025 + y * 0.03 + time * 0.3) * 4;
      
      positions.setZ(i, wave1 + wave2 + wave3 + wave4);
    }
    
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    
    // Create EXTREMELY vibrant gradient colors matching reference image
    const colors = [];
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const normalizedX = (x + width / 2) / width; // 0 to 1 (left to right)
      const normalizedY = (y + height / 2) / height; // 0 to 1 (bottom to top)
      
      // Aurora colors: MAXIMUM VIBRANCY like reference (purple, magenta, pink, cyan, green)
      let r, g, b;
      
      // Create color variation based on X position and layer for depth
      const colorShift = layer * 0.15; // Layer offset for color variation
      const xOffset = (normalizedX + colorShift) % 1.0;
      
      // Reference image analysis: Strong purples, magentas, pinks, and bright greens/cyans
      // Create dramatic color zones with MAXIMUM saturation
      if (xOffset < 0.2) {
        // Zone 1: INTENSE MAGENTA/PINK (like reference)
        const t = xOffset * 5; // 0 to 1
        r = 0.95 + t * 0.05; // Maximum bright magenta/pink (0.95-1.0)
        g = 0.1 + t * 0.15; // Low green for magenta
        b = 0.85 + t * 0.1; // High blue for magenta (0.85-0.95)
      } else if (xOffset < 0.4) {
        // Zone 2: BRIGHT PURPLE (reference has strong purple)
        const t = (xOffset - 0.2) * 5; // 0 to 1
        r = 0.9 - t * 0.1; // Bright purple red (0.9-0.8)
        g = 0.15 + t * 0.1; // Low green
        b = 0.95 - t * 0.05; // Maximum purple-blue (0.95-0.9)
      } else if (xOffset < 0.6) {
        // Zone 3: VIVID CYAN/TURQUOISE (reference transition color)
        const t = (xOffset - 0.4) * 5; // 0 to 1
        r = 0.1 - t * 0.05; // Very low red (0.1-0.05)
        g = 0.7 + t * 0.25; // Increasing bright cyan-green (0.7-0.95)
        b = 0.95 - t * 0.1; // High cyan-blue (0.95-0.85)
      } else if (xOffset < 0.8) {
        // Zone 4: INTENSE GREEN (reference has vibrant green bands)
        const t = (xOffset - 0.6) * 5; // 0 to 1
        r = 0.05 + t * 0.15; // Very low red
        g = 0.95 - t * 0.05; // Maximum bright green (0.95-0.9)
        b = 0.5 + t * 0.15; // Medium-high blue for cyan-green (0.5-0.65)
      } else {
        // Zone 5: GREEN to MAGENTA transition (cycling back)
        const t = (xOffset - 0.8) * 5; // 0 to 1
        r = 0.2 + t * 0.7; // Increasing red for magenta (0.2-0.9)
        g = 0.85 - t * 0.7; // Decreasing green (0.85-0.15)
        b = 0.6 + t * 0.3; // Increasing blue for magenta (0.6-0.9)
      }
      
      // Add vertical brightness variation (brighter at top like reference)
      const verticalBrightness = 0.85 + normalizedY * 0.15; // Brighter at top (0.85-1.0)
      r *= verticalBrightness;
      g *= verticalBrightness;
      b *= verticalBrightness;
      
      // EXTREME boost for MAXIMUM vibrancy matching reference
      const maxChannel = Math.max(r, g, b);
      if (maxChannel > 0) {
        const boostFactor = 1.5; // 50% boost for extreme vibrancy like reference
        r = Math.min(1.0, r * boostFactor);
        g = Math.min(1.0, g * boostFactor);
        b = Math.min(1.0, b * boostFactor);
      }
      
      // Ensure colors are within valid range
      r = Math.min(1.0, Math.max(0.0, r));
      g = Math.min(1.0, Math.max(0.0, g));
      b = Math.min(1.0, Math.max(0.0, b));
      
      colors.push(r, g, b);
    }
    
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    
   // Base opacity: VERY HIGH like reference image - extremely visible day and night
      const baseOpacity = 0.90; // High opacity for maximum visibility
      const layerOpacity = baseOpacity - layer * 0.05; // Minimal layer fade for maximum visibility
    
    const material = new THREE.MeshBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: layerOpacity,
  side: THREE.DoubleSide,
  blending: THREE.NormalBlending,  // Changed from AdditiveBlending
  depthWrite: false
});
    
    const aurora = new THREE.Mesh(geometry, material);
    
    // Position the aurora in the sky (moved higher)
    aurora.position.set(0, 200 + layer * 12, -150 - layer * 35);
    aurora.rotation.x = Math.PI * 0.3; // Tilt towards viewer
    aurora.userData.isNorthernLights = true;
    aurora.userData.layer = layer;
    aurora.userData.time = time;
    aurora.userData.baseOpacity = 0.9;
    
    // Add gentle downward-pointing directional light for each aurora layer
    // Use aurora colors (green, cyan, purple, magenta) with low intensity for gentle illumination
    const auroraLightColor = layer < 2 ? 0x88ffaa : layer < 4 ? 0x88aaff : 0xaa88ff; // Green to blue to purple based on layer
    const auroraLight = new THREE.DirectionalLight(auroraLightColor, 0.15 - layer * 0.02); // Gentle, decreasing intensity per layer
    auroraLight.position.set(0, 250 + layer * 12, -150 - layer * 35); // Slightly above aurora
    auroraLight.target.position.set(0, 0, 0); // Point downward
    auroraLight.castShadow = false; // Don't cast shadows for performance
    auroraLight.userData.isNorthernLights = true;
    auroraLight.userData.isAuroraLight = true;
    auroraLight.userData.layer = layer;
    
    scene.add(auroraLight);
    scene.add(auroraLight.target);
    
    scene.add(aurora);
    layers.push(aurora);
  }
  
  console.log(`[NORTHERN LIGHTS] Created ${layers.length} aurora layers (MAXIMUM VIBRANCY like reference)`);
  return layers;
};

  const animateNorthernLights = (scene) => {
  const lights = scene.children.filter(c => c.userData?.isNorthernLights);
  
  if (lights.length === 0) return;
  
  const time = Date.now() * 0.001;
  
  // UPDATED: Check current lighting for day/night to adjust opacity
  const currentLighting = currentWorld?.world?.lighting_config;
  let isDay = true;
  if (currentLighting?.background) {
    const bgColor = new THREE.Color(currentLighting.background);
    const hsl = {};
    bgColor.getHSL(hsl);
    isDay = hsl.l > 0.4;
  }
  
  // Position northern lights to follow player/camera so they're always visible
  const player = playerRef.current;
  const cam = cameraRef.current;
  if (player && cam) {
    // Get camera's forward direction to position aurora in front of camera view
    const camForward = new THREE.Vector3();
    cam.getWorldDirection(camForward);
    camForward.y = 0; // Keep horizontal
    camForward.normalize();
    
    lights.forEach((object) => {
      // Skip light targets - they'll be updated with their parent lights
      if (object.userData?.isAuroraLightTarget) return;
      
      const layer = object.userData.layer;
      // Position in front of player, high in the sky, in the camera's view direction
      const forwardDistance = 150 + layer * 35;
      const yPos = 200 + layer * 12;
      
      if (object.userData?.isAuroraLight) {
        // Update aurora light position (slightly above aurora)
        object.position.set(
        player.position.x + camForward.x * forwardDistance,
          yPos + 50, // Slightly above aurora
        player.position.z + camForward.z * forwardDistance
      );
        // Update light target to point downward
        if (object.target) {
          object.target.position.set(
            player.position.x + camForward.x * forwardDistance,
            player.position.y, // Point at player/ground level
            player.position.z + camForward.z * forwardDistance
          );
        }
      } else {
        // Update aurora mesh position
        object.position.set(
          player.position.x + camForward.x * forwardDistance,
          yPos,
          player.position.z + camForward.z * forwardDistance
        );
      }
    });
  } else if (player) {
    // Fallback: position relative to player if camera not available
    lights.forEach((object) => {
      // Skip light targets
      if (object.userData?.isAuroraLightTarget) return;
      
      const layer = object.userData.layer;
      const yPos = 200 + layer * 12;
      
      if (object.userData?.isAuroraLight) {
        // Update aurora light position
        object.position.set(
        player.position.x,
          yPos + 50,
        player.position.z + 150 + layer * 35
      );
        // Update light target
        if (object.target) {
          object.target.position.set(
            player.position.x,
            player.position.y,
            player.position.z + 150 + layer * 35
          );
        }
      } else {
        // Update aurora mesh position
        object.position.set(
          player.position.x,
          yPos,
          player.position.z + 150 + layer * 35
        );
      }
    });
  }
  
  // Only animate aurora meshes (not lights)
  const auroraMeshes = lights.filter(l => !l.userData?.isAuroraLight && l.geometry);
  
  auroraMeshes.forEach((aurora) => {
    const layer = aurora.userData.layer;
    const geometry = aurora.geometry;
    const positions = geometry.attributes.position;
    
    // Animate vertices for flowing effect with more variation
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      
      // Create flowing wave pattern with more complexity
      const wave1 = Math.sin(x * 0.008 + time + layer) * 8;
      const wave2 = Math.sin(x * 0.015 - time * 0.7 + layer * 0.5) * 5;
      const wave3 = Math.cos(y * 0.04 + time * 0.4) * 3;
      const wave4 = Math.sin(x * 0.025 + y * 0.03 + time * 0.3) * 4;
      
      positions.setZ(i, wave1 + wave2 + wave3 + wave4);
    }
    
    positions.needsUpdate = true;
    
    // UPDATED: Adjust opacity based on time of day with gentle pulsing - very high for visibility
   // UPDATED: Adjust opacity with gentle pulsing - very high for visibility
    const baseOpacity = 0.90; // High opacity like reference
    const pulse = Math.sin(time * 0.5 + layer) * 0.05;
    aurora.material.opacity = baseOpacity - layer * 0.05 + pulse;
  });
};
  // Camera capture functions for Overshoot AI scanning
  const startCameraCapture = async () => {
    try {
      // Prevent concurrent streaming
      if (streamingActive || overshootVisionRef.current) {
        console.warn('[CAMERA] Streaming already active, ignoring request');
        return;
      }

      // Check if getUserMedia is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Camera API is not supported in this browser. Please use Chrome, Firefox, Edge, or Safari.');
        return;
      }

      // Check if we're on HTTPS or localhost (required for camera access)
      const hostname = location.hostname;
      const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
      const isHTTPS = location.protocol === 'https:';
      
      // If using IP address (not localhost), warn user
      if (!isLocalhost && !isHTTPS) {
        const useLocalhost = confirm(
          '⚠️ Camera access requires HTTPS or localhost.\n\n' +
          'You are currently using: ' + hostname + ':3000\n\n' +
          'SOLUTION: Access the site via localhost instead:\n' +
          'http://localhost:3000\n\n' +
          'Click OK to open localhost:3000, or Cancel to continue (may not work).'
        );
        
        if (useLocalhost) {
          window.location.href = 'http://localhost:3000';
          return;
        }
        console.warn('[CAMERA] Attempting camera access from non-secure context:', hostname);
      }

      // Start streaming - sends frames to OpenAI and video to Overshoot (both via backend)
      console.log('[CAMERA] Starting video streaming...');
      await startStreamingCapture();
      
    } catch (error) {
      console.error('[CAMERA] Error starting streaming or camera:', error);
    }
  };

  const startBasicCamera = async () => {
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 }
          } 
        });
      } catch (constraintError) {
        console.log('[CAMERA] Advanced constraints failed, trying basic video...');
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          console.log('[CAMERA] Camera ready:', videoRef.current.videoWidth, 'x', videoRef.current.videoHeight);
        };
      }
      setScanMode(true);
      console.log('[CAMERA] Camera access granted (basic mode)');
    } catch (error) {
      console.error('[CAMERA] Error accessing camera:', error);
      handleCameraError(error);
    }
  };

  // Ref for streaming interval and video recording
  const streamingIntervalRef = useRef(null);
  const overshootResultCountRef = useRef(0);
  const worldGeneratedFromScanRef = useRef(false); // Prevent multiple world generations
  const accumulatedObjectsRef = useRef({}); // Accumulate scanned objects across results
  const processedScenesRef = useRef(new Set()); // Track processed scene descriptions (deduplication)
  const latestScanDataRef = useRef(null); // Store latest scan result for world generation on stop
  const frameCounterRef = useRef(0); // Track frame numbers for optimized processing

  // Main streaming function - uses Overshoot SDK directly for real-time video analysis
  const startStreamingCapture = async () => {
    try {
      console.log('[STREAMING] Starting capture with Overshoot SDK...');
      
      // Reset previous scan results
      setLastScanResult(null);
      overshootResultCountRef.current = 0;
      worldGeneratedFromScanRef.current = false; // Allow new world generation
      accumulatedObjectsRef.current = {}; // Reset accumulated objects
      processedScenesRef.current.clear(); // Clear processed scenes for new scan session
      frameCounterRef.current = 0; // Reset frame counter
      latestScanDataRef.current = null; // Reset latest scan data
      
      // First, enable the UI
      setStreamingActive(true);
      setScanMode(false);
      
      // Configuration object for Overshoot SDK (matches official documentation format)
      const overshootConfig = {
        apiUrl: OVERSHOOT_API_URL,
        apiKey: OVERSHOOT_API_KEY,
        prompt: `Describe the ENTIRE visible scene in extreme detail for 3D model generation. Return JSON with:
{
  "scene_description": "Detailed description of everything visible: objects, walls, floor, ceiling, background, their positions, materials, colors (hex), textures, lighting, scale. Example: 'A black coffee maker sits on a white marble countertop. Behind it is a light gray wall extending 4 feet wide. Natural light from the right. The countertop is 36 inches high.'",
  "scene_type": "indoor|outdoor|landmark|object_closeup",
  "primary_elements": [{"name": "object", "description": "details", "position": "center", "materials": ["material"], "colors": {"primary": "#HEX"}}],
  "colors": {"palette": ["#HEX", "#HEX", "#HEX"]},
  "scale_reference": "real-world dimensions if identifiable"
}
Ignore people. Include ALL visible elements - this will create the complete 3D world.`,
        source: { type: 'camera', cameraFacing: 'environment' },
        processing: {
          clip_length_seconds: 1,
          delay_seconds: 1,
          fps: 30,
          sampling_ratio: 0.1  // Default per documentation: 10% of frames (3 fps at 30fps)
        },
        onResult: async (result) => {
          overshootResultCountRef.current++;
          const resultNum = overshootResultCountRef.current;
          
          console.log(`[OVERSHOOT] ✅ Result #${resultNum}:`, result.result);
          
          try {
            // Parse the result (Overshoot returns result.result as the AI response)
            let parsed = result.result;
            if (typeof parsed === 'string') {
              // Try to extract JSON from the response
              const jsonMatch = parsed.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                try {
                  // Clean up common JSON issues before parsing
                  let jsonStr = jsonMatch[0];
                  // Replace invalid "#HEX" placeholders with valid hex colors
                  jsonStr = jsonStr.replace(/"#HEX"/g, '"#000000"');
                  // Fix invalid color patterns: "primary": "#HEX1", "#HEX2" becomes "primary": "#HEX1"
                  // This pattern has multiple hex values where the second one is invalid (not a key-value pair)
                  jsonStr = jsonStr.replace(/"primary":\s*"(#[A-F0-9]{6})",\s*"#[A-F0-9]{6}"/g, '"primary": "$1"');
                  // More aggressive: remove any standalone hex strings after commas (invalid JSON property)
                  jsonStr = jsonStr.replace(/,\s*"#[A-F0-9]{6}"/g, '');
                  parsed = JSON.parse(jsonStr);
                } catch (jsonParseError) {
                  console.warn(`[OVERSHOOT] JSON parse failed, trying to fix and retry: ${jsonParseError.message}`);
                  // Try more aggressive fixes
                  let jsonStr = jsonMatch[0];
                  // Replace invalid "#HEX" placeholders
                  jsonStr = jsonStr.replace(/"#HEX"/g, '"#000000"');
                  // Fix patterns like {"primary": "#HEX1", "#HEX2", "#HEX3"} - keep only first hex
                  // This regex handles 1 or more trailing hex values after the first
                  jsonStr = jsonStr.replace(/"primary":\s*"(#[A-F0-9]{6})"(\s*,\s*"#[A-F0-9]{6}")+/g, '"primary": "$1"');
                  // Remove any standalone hex strings after commas (they're not valid JSON keys)
                  jsonStr = jsonStr.replace(/,\s*"#[A-F0-9]{6}"/g, '');
                  try {
                    parsed = JSON.parse(jsonStr);
                  } catch (retryError) {
                    console.error(`[OVERSHOOT] JSON parse failed after fixes: ${retryError.message}`);
                    // Let it fall through to outer catch block
                    throw retryError;
                  }
                }
              }
            }
            
            // Accumulate objects across multiple results
            if (parsed?.objects) {
              for (const [objName, count] of Object.entries(parsed.objects)) {
                const currentCount = accumulatedObjectsRef.current[objName] || 0;
                const newCount = typeof count === 'number' ? count : 1;
                // Keep the max count seen for each object
                accumulatedObjectsRef.current[objName] = Math.max(currentCount, newCount);
              }
            }
            
            setLastScanResult({
              biome: parsed?.biome || 'unknown',
              timestamp: new Date().toLocaleTimeString(),
              frameCount: resultNum,
              source: 'overshoot',
              raw_text: typeof result.result === 'string' ? result.result.substring(0, 50) : null,
              accumulatedObjects: { ...accumulatedObjectsRef.current }
            });
            
            // Store scan data for world generation when streaming stops (defer generation)
            // Keep the latest scan result with scene description
            const sceneDesc = parsed?.scene_description;
            if (sceneDesc && !worldGeneratedFromScanRef.current) {
              // Store latest scan data for generation on stop
              latestScanDataRef.current = {
                sceneDescription: sceneDesc,
                parsedData: parsed,
                frameNumber: resultNum
              };
              console.log(`[OVERSHOOT] 📸 Storing scan data for world generation on stop (Frame #${resultNum})...`);
            }
          } catch (parseError) {
            console.log('[OVERSHOOT] Could not parse result as JSON:', parseError.message);
            setLastScanResult({
              biome: 'unknown',
              timestamp: new Date().toLocaleTimeString(),
              frameCount: resultNum,
              source: 'overshoot',
              raw_text: typeof result.result === 'string' ? result.result.substring(0, 50) : 'non-string result'
            });
          }
        },
        onError: (error) => {
          console.error('[OVERSHOOT] SDK Error:', error);
          console.error('[OVERSHOOT] Error details:', {
            message: error.message,
            name: error.name,
            stack: error.stack
          });
          
          // Log specific error types
          if (error.message && error.message.includes('422')) {
            console.error('[OVERSHOOT] 422 Validation Error detected - SDK may need configuration adjustments');
            console.error('[OVERSHOOT] This might be an SDK version issue or API format change');
          } else if (error.message && (error.message.includes('401') || error.message.includes('403'))) {
            console.error('[OVERSHOOT] Authentication Error - check API key');
          }
        }
      };
      
      // Log configuration before creating instance
      console.log('[OVERSHOOT] Configuration being passed:', {
        apiUrl: overshootConfig.apiUrl,
        apiKey: overshootConfig.apiKey ? `${overshootConfig.apiKey.substring(0, 10)}...` : 'NOT SET',
        hasPrompt: !!overshootConfig.prompt,
        promptLength: overshootConfig.prompt ? overshootConfig.prompt.length : 0,
        hasSource: !!overshootConfig.source,
        sourceType: overshootConfig.source?.type || 'N/A',
        hasProcessing: !!overshootConfig.processing,
        processingConfig: overshootConfig.processing
      });
      
      // Create Overshoot RealtimeVision instance
      const vision = new RealtimeVision(overshootConfig);
      
      // Start the Overshoot vision
      console.log('[OVERSHOOT] Starting RealtimeVision...');
      
      await vision.start();
      console.log('[OVERSHOOT] ✅ RealtimeVision started successfully');
      
      // Store reference for cleanup
      overshootVisionRef.current = vision;
      
      // Also get camera stream for the preview video element
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            facingMode: 'environment',
            width: { ideal: 640 },
            height: { ideal: 480 }
          } 
        });
        setCameraStream(stream);
        
        // Wait for video element and set up preview
        const setupPreview = () => {
      if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => {});
            return true;
          }
          return false;
        };
        
        // Try to set up preview, retry if needed
        if (!setupPreview()) {
          let attempts = 0;
          const checkInterval = setInterval(() => {
            attempts++;
            if (setupPreview() || attempts >= 20) {
              clearInterval(checkInterval);
            }
          }, 100);
        }
      } catch (previewError) {
        console.log('[OVERSHOOT] Preview setup skipped (SDK handles camera):', previewError.message);
      }
      
    } catch (error) {
      console.error('[STREAMING] Error starting Overshoot SDK:', error);
      console.error('[STREAMING] Error type:', error.constructor.name);
      console.error('[STREAMING] Error message:', error.message);
      console.error('[STREAMING] Error stack:', error.stack);
      
      let errorMessage = 'Failed to start Overshoot streaming.\n\n';
      
      if (error.message && (error.message.includes('fetch') || error.message.includes('network'))) {
        errorMessage += '⚠️ Network Error: Cannot reach Overshoot API.\n\n';
      } else if (error.message && (error.message.includes('401') || error.message.includes('403') || error.message.includes('Unauthorized'))) {
        errorMessage += 'Authentication Error: Invalid API key.\n\n';
      } else if (error.message && (error.message.includes('422') || error.message.includes('validation'))) {
        errorMessage += '⚠️ Validation Error (422): SDK request format issue.\n';
        errorMessage += 'This may be an SDK version issue. Falling back to OpenAI frame analysis.\n\n';
      } else if (error.message && error.message.includes('NotAllowedError')) {
        errorMessage += 'Camera permission denied. Please allow camera access.\n\n';
      } else {
        errorMessage += `Error: ${error.message || 'Unknown error'}\n\n`;
      }
      
      console.warn(errorMessage);
      
      // Try fallback to OpenAI frame analysis
      console.log('[OVERSHOOT] Falling back to OpenAI frame analysis...');
      await startFallbackFrameAnalysis();
    }
  };

  // Fallback: Use OpenAI via backend for frame-by-frame analysis when Overshoot SDK fails
  const startFallbackFrameAnalysis = async () => {
    try {
      console.log('[FALLBACK] Starting OpenAI frame analysis via backend...');
      
      // Get camera stream
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            facingMode: 'environment',
            width: { ideal: 640 },
            height: { ideal: 480 }
          } 
        });
      } catch (constraintError) {
        console.log('[FALLBACK] Advanced constraints failed, trying basic video...');
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      
      setCameraStream(stream);
      setStreamingActive(true);
      setScanMode(false);
      
      // Set up video preview
      const setupPreview = () => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
          return true;
        }
        return false;
      };
      
      // Wait for video element
      await new Promise((resolve) => {
        if (setupPreview()) {
          resolve();
        } else {
          let attempts = 0;
          const checkInterval = setInterval(() => {
            attempts++;
            if (setupPreview() || attempts >= 20) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);
        }
      });
      
      // Start frame capture interval (sends to OpenAI via backend)
      let frameCount = 0;
      let isAnalyzing = false;
      
      const captureFrame = async () => {
        if (!videoRef.current || videoRef.current.videoWidth === 0 || isAnalyzing) return;
        
        isAnalyzing = true;
        frameCount++;
        
        try {
          const canvas = document.createElement('canvas');
          canvas.width = videoRef.current.videoWidth;
          canvas.height = videoRef.current.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(videoRef.current, 0, 0);
          const imageData = canvas.toDataURL('image/jpeg', 0.7);
          
          console.log(`[FALLBACK/OPENAI] 📸 Frame #${frameCount} → backend/scan-world`);
          
          const res = await fetch(`${API_BASE}/scan-world`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_data: imageData }),
          });
          
          if (res.ok) {
            const data = await res.json();
            console.log(`[FALLBACK/OPENAI] ✅ Frame #${frameCount} analyzed - Biome: ${data.biome || 'unknown'}`);
            
            // Check for TripoSR generation result
            if (data.world?.model_url) {
              console.log(`[FALLBACK/OPENAI] ✅ TripoSR model generated: ${data.world.model_url}`);
              console.log(`[FALLBACK/OPENAI] World type: ${data.world.type}`);
            } else if (data.error) {
              console.error(`[FALLBACK/OPENAI] ⚠️ Backend Error: ${data.error}`);
              console.error(`[FALLBACK/OPENAI] 💡 TripoSR generation failed - check backend logs`);
            } else if (data.world?.type === 'scan_fallback') {
              console.warn(`[FALLBACK/OPENAI] ⚠️ TripoSR generation failed - using fallback world`);
              console.warn(`[FALLBACK/OPENAI] 💡 This means AIML_API_KEY or TripoSR API is not working`);
            }
            
            setLastScanResult({
              biome: data.biome || data.world?.scene_type || 'unknown',
              timestamp: new Date().toLocaleTimeString(),
              frameCount: frameCount,
              source: 'openai-fallback'
            });
            
            if (gameState !== GameState.PLAYING && (data.biome || data.world)) {
              await loadWorldFromScan(data);
            }
          } else {
            const errorText = await res.text();
            console.error(`[FALLBACK/OPENAI] ❌ Request failed: ${res.status} - ${errorText}`);
          }
        } catch (error) {
          console.error('[FALLBACK/OPENAI] Frame error:', error);
        }
        
        isAnalyzing = false;
      };
      
      // Optimized frame rate: Capture every 1 second (as per guide: 1 frame per second)
      // This balances API costs with scene coverage
      captureFrame();
      streamingIntervalRef.current = setInterval(captureFrame, 1000); // 1 second = 1 frame/sec (guide recommendation)
      
      // Store stop function
      overshootVisionRef.current = {
        stop: () => {
          if (streamingIntervalRef.current) {
            clearInterval(streamingIntervalRef.current);
            streamingIntervalRef.current = null;
          }
        }
      };
      
    } catch (error) {
      console.error('[FALLBACK] Error starting frame analysis:', error);
      alert('Could not access camera. Please check permissions.');
    }
  };

  const processStreamingResult = async (analysis) => {
    try {
      console.log('[OVERSHOOT] Processing streaming result:', analysis);
      
      // Send to backend to generate world from streaming analysis
      const res = await fetch(`${API_BASE}/scan-world`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          streaming_analysis: analysis,
          use_streaming: true 
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error('[OVERSHOOT] Backend error:', errorText);
        return;
      }

      const data = await res.json();
      
      // Only update world if we're not already playing (to avoid interruptions)
      if (gameState !== GameState.PLAYING) {
        console.log('[OVERSHOOT] Updating world from streaming analysis...');
        await loadWorldFromScan(data);
      } else {
        // If already playing, we could do incremental updates
        console.log('[OVERSHOOT] World already active, skipping update');
      }
      
    } catch (error) {
      console.error('[OVERSHOOT] Error processing result:', error);
    }
  };

  const loadWorldFromScan = async (data) => {
    console.log('[SCAN] Loading scanned world...', data);
    
    const scene = sceneRef.current;
    if (!scene) {
      console.error('[SCAN] Scene not available');
      return;
    }

    // Clear existing world
    const objectsToRemove = [];
    scene.children.forEach((child) => {
      if (!child.isLight && !child.userData?.isSky) objectsToRemove.push(child);
    });
    objectsToRemove.forEach((obj) => scene.remove(obj));
    
    terrainMeshRef.current = null;
    enemiesRef.current = [];
    structuresRef.current = [];
    occupiedCells.clear();

    // NEW: Check if this is a complete scanned environment
    if (data.world?.type === 'scanned_environment' && data.world?.model_url) {
      console.log('[SCAN] 🎨 Loading complete scanned 3D environment...');
      console.log('[SCAN] Model URL:', data.world.model_url);
      console.log('[SCAN] Scene:', data.world.scene_description?.substring(0, 100));
      
      // Load the single GLB model that represents the entire scanned scene
      const loader = new GLTFLoader();
      
      // Create loading placeholder
      const placeholderGeometry = new THREE.BoxGeometry(2, 2, 2);
      const placeholderMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x4A90E2,
        transparent: true,
        opacity: 0.3,
        wireframe: true
      });
      const placeholder = new THREE.Mesh(placeholderGeometry, placeholderMaterial);
      placeholder.position.set(0, 1, 0);
      scene.add(placeholder);
      
      console.log('[SCAN] ⏳ Loading 3D model... (this may take 10-30 seconds)');
      
      loader.load(
        data.world.model_url,
        (gltf) => {
          // Success! Remove placeholder and add actual scene
          scene.remove(placeholder);
          
          const sceneModel = gltf.scene;
          console.log('[SCAN] ✅ 3D scene loaded successfully!');
          
          // Enable shadows for all meshes
          sceneModel.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          
          // Calculate bounding box for scaling and positioning
          const bbox = new THREE.Box3().setFromObject(sceneModel);
          const size = bbox.getSize(new THREE.Vector3());
          const center = bbox.getCenter(new THREE.Vector3());
          
          console.log('[SCAN] Scene size:', size);
          console.log('[SCAN] Scene center:', center);
          
          // Position scene at origin
          sceneModel.position.set(0, 0, 0);
          
          // Ensure scene sits on ground (y=0)
          const minY = bbox.min.y;
          sceneModel.position.y -= minY;
          
          // Add to scene
          scene.add(sceneModel);
          structuresRef.current.push(sceneModel);
          
          console.log('[SCAN] 🎉 Complete scanned environment loaded!');
          
          // Set spawn point in front of the scene
          const spawnDistance = Math.max(size.z, 5) * 1.5;  // 1.5x scene depth or 5 units min
          const spawnPoint = {
            x: center.x,
            y: 1.0,
            z: center.z + spawnDistance
          };
          
          // Create player
          const playerMesh = createPlayer(
            { x: spawnPoint.x, z: spawnPoint.z },
            spawnPoint.y
          );
          scene.add(playerMesh);
          
          // Set player to look at scene center
          if (cameraRef.current) {
            const lookAtPoint = new THREE.Vector3(center.x, center.y + 1, center.z);
            cameraRef.current.lookAt(lookAtPoint);
          }
          
          console.log('[SCAN] Player spawned at:', spawnPoint);
        },
        (progress) => {
          if (progress.total > 0) {
            const percent = (progress.loaded / progress.total * 100).toFixed(0);
            if (percent % 10 === 0) {  // Log every 10%
              console.log(`[SCAN] Loading: ${percent}%`);
            }
          }
        },
        (error) => {
          console.error('[SCAN] ❌ Failed to load scanned environment:', error);
          scene.remove(placeholder);
          
          // Show error message to user
          alert('Failed to load 3D scene. The model may be too large or corrupted. Try scanning again.');
        }
      );
      
      // Set appropriate lighting for scanned environment
      const lighting = data.world.lighting || {};
      const lightingConfig = {
        ambient: {
          color: "#FFFFFF",
          intensity: 1.2  // Bright for scanning
        },
        directional: {
          color: "#FFFFFF",
          intensity: 0.8,
          position: { x: 5, y: 10, z: 5 }
        },
        fog: null,
        background: "#87CEEB"  // Light blue sky
      };
      updateLighting(lightingConfig, {});
      
      return;  // Done loading scanned environment
    }
    
    // OLD: Legacy room/biome generation (fallback if scan fails)
    console.warn('[SCAN] ⚠️ Using legacy world generation (scan may have failed)');
    
    // Check if TripoSR failed and log details
    if (data.error) {
      console.error(`[SCAN] ❌ TripoSR Error: ${data.error}`);
      console.error(`[SCAN] 💡 Check backend logs for detailed TripoSR error message`);
      console.error(`[SCAN] 💡 Common causes:`);
      console.error(`[SCAN]    - AIML_API_KEY not set or invalid`);
      console.error(`[SCAN]    - No credits in AIMLAPI account`);
      console.error(`[SCAN]    - Image URL is localhost (AIMLAPI cannot access localhost URLs)`);
      console.error(`[SCAN]    - BACKEND_URL not set to publicly accessible URL (e.g., use ngrok)`);
      console.error(`[SCAN]    - Network error`);
    } else if (data.world?.type === 'scan_fallback') {
      console.warn(`[SCAN] ⚠️ Backend returned scan_fallback - TripoSR generation failed`);
      console.warn(`[SCAN] 💡 This means AIML_API_KEY or TripoSR API is not working properly`);
    } else if (!data.world?.model_url) {
      console.warn(`[SCAN] ⚠️ No model_url in response - TripoSR generation did not complete`);
      console.warn(`[SCAN] 💡 Backend response:`, data);
    }
    
    // Create kitchen room for room/indoor/kitchen biomes when scan fails or no model_url
    const biomeName = data.world?.biome || data.world?.biome_name || data.biome;
    const isRoomBiome = biomeName && (biomeName.toLowerCase() === 'room' || biomeName.toLowerCase() === 'indoor' || biomeName.toLowerCase() === 'kitchen');
    const isKitchen = biomeName && biomeName.toLowerCase() === 'kitchen';
    
    if (isRoomBiome && (!data.world?.model_url || data.world?.type === 'scan_fallback')) {
      if (isKitchen) {
        console.log('[SCAN] 🍳 Creating detailed kitchen matching reference image...');
      } else {
        console.log('[SCAN] 🏠 Creating basic room...');
      }
      
      // Ensure structures object exists
      if (!data.structures) {
        data.structures = {};
      }
      
      // Create room with white textured walls
      const wallColor = 0xFFFFFF; // White walls (textured appearance)
      const roomSize = 25; // Room dimensions
      const wallHeight = 10; // Standard ceiling height
      
      // Create room walls, floor, ceiling
      data.structures.walls = [
        // Back wall
        {
          dimensions: { width: roomSize, height: wallHeight, depth: 0.5 },
          position: { x: 0, y: wallHeight / 2, z: -roomSize / 2 },
          color: wallColor,
          type: 'wall'
        },
        // Front wall
        {
          dimensions: { width: roomSize, height: wallHeight, depth: 0.5 },
          position: { x: 0, y: wallHeight / 2, z: roomSize / 2 },
          color: wallColor,
          type: 'wall'
        },
        // Left wall
        {
          dimensions: { width: 0.5, height: wallHeight, depth: roomSize },
          position: { x: -roomSize / 2, y: wallHeight / 2, z: 0 },
          color: wallColor,
          type: 'wall'
        },
        // Right wall
        {
          dimensions: { width: 0.5, height: wallHeight, depth: roomSize },
          position: { x: roomSize / 2, y: wallHeight / 2, z: 0 },
          color: wallColor,
          type: 'wall'
        },
        // Floor
        {
          dimensions: { width: roomSize, height: 0.2, depth: roomSize },
          position: { x: 0, y: 0, z: 0 },
          color: 0xD3D3D3, // Light neutral floor
          type: 'floor'
        },
        // Ceiling
        {
          dimensions: { width: roomSize, height: 0.2, depth: roomSize },
          position: { x: 0, y: wallHeight, z: 0 },
          color: 0xFFFFFF, // White ceiling
          type: 'ceiling'
        }
      ];
      
      // Initialize scanned_objects
      if (!data.structures.scanned_objects) {
        data.structures.scanned_objects = [];
      }
      
      // Generate detailed kitchen matching reference image
      if (isKitchen) {
        // Kitchen dimensions (matching reference image layout)
        const cabinetColor = 0xD2B48C; // Light wood cabinets (tan/beige)
        const counterColor = 0xF5F5DC; // Light beige speckled countertop
        const backsplashColor = 0xC0C0C0; // Stainless steel backsplash
        const stoveColor = 0xFFFFFF; // White stove
        const sinkColor = 0xC0C0C0; // Stainless steel sink
        const refrigeratorColor = 0xFFFFFF; // White refrigerator
        const counterHeight = 3; // Standard counter height (36 inches)
        const counterDepth = 2; // Counter depth (24 inches)
        const upperCabinetHeight = 3; // Upper cabinet height
        const upperCabinetBottom = 7; // Upper cabinets start above counter
        
        // L-SHAPED COUNTER: Back wall + Right wall + Extended left counter
        const backWallCabinetZ = -roomSize / 2 + counterDepth / 2;
        const rightWallCabinetX = roomSize / 2 - counterDepth / 2;
        const lowerCabinetY = counterHeight / 2;
        const counterTopY = counterHeight + 0.05;
        
        // === LOWER CABINETS ===
        // Back wall cabinets (L-shape left side)
        data.structures.scanned_objects.push(
          {
            name: 'lower_cabinet_back_1',
            position: { x: -8, y: lowerCabinetY, z: backWallCabinetZ },
            scale: 1,
            rotation: { x: 0, y: 0, z: 0 },
            parts: [{
              shape: 'box',
              dimensions: { width: 4, height: counterHeight, depth: counterDepth },
              position: { x: 0, y: 0, z: 0 },
              color: cabinetColor,
              material: { roughness: 0.7, metalness: 0.1 }
            }]
          },
          {
            name: 'lower_cabinet_back_2',
            position: { x: -3, y: lowerCabinetY, z: backWallCabinetZ },
            scale: 1,
            rotation: { x: 0, y: 0, z: 0 },
            parts: [{
              shape: 'box',
              dimensions: { width: 4, height: counterHeight, depth: counterDepth },
              position: { x: 0, y: 0, z: 0 },
              color: cabinetColor,
              material: { roughness: 0.7, metalness: 0.1 }
            }]
          }
        );
        
        // Right wall cabinets (L-shape continuation)
        data.structures.scanned_objects.push(
          {
            name: 'lower_cabinet_right_1',
            position: { x: rightWallCabinetX, y: lowerCabinetY, z: -5 },
            scale: 1,
            rotation: { x: 0, y: Math.PI / 2, z: 0 },
            parts: [{
              shape: 'box',
              dimensions: { width: 4, height: counterHeight, depth: counterDepth },
              position: { x: 0, y: 0, z: 0 },
              color: cabinetColor,
              material: { roughness: 0.7, metalness: 0.1 }
            }]
          },
          {
            name: 'lower_cabinet_right_2',
            position: { x: rightWallCabinetX, y: lowerCabinetY, z: 0 },
            scale: 1,
            rotation: { x: 0, y: Math.PI / 2, z: 0 },
            parts: [{
              shape: 'box',
              dimensions: { width: 4, height: counterHeight, depth: counterDepth },
              position: { x: 0, y: 0, z: 0 },
              color: cabinetColor,
              material: { roughness: 0.7, metalness: 0.1 }
            }]
          }
        );
        
        // === COUNTERTOPS ===
        // Back wall countertop
        data.structures.scanned_objects.push({
          name: 'countertop_back',
          position: { x: -5.5, y: counterTopY, z: backWallCabinetZ },
          scale: 1,
          rotation: { x: 0, y: 0, z: 0 },
          parts: [{
            shape: 'box',
            dimensions: { width: 8, height: 0.15, depth: counterDepth },
            position: { x: 0, y: 0, z: 0 },
            color: counterColor,
            material: { roughness: 0.3, metalness: 0.0 }
          }]
        });
        
        // Right wall countertop (L-shape continuation)
        data.structures.scanned_objects.push({
          name: 'countertop_right',
          position: { x: rightWallCabinetX, y: counterTopY, z: -2.5 },
          scale: 1,
          rotation: { x: 0, y: Math.PI / 2, z: 0 },
          parts: [{
            shape: 'box',
            dimensions: { width: 8, height: 0.15, depth: counterDepth },
            position: { x: 0, y: 0, z: 0 },
            color: counterColor,
            material: { roughness: 0.3, metalness: 0.0 }
          }]
        });
        
        // Extended left counter/bar (shallower, extends into room)
        data.structures.scanned_objects.push({
          name: 'counter_left_extended',
          position: { x: -8, y: counterTopY, z: 5 },
          scale: 1,
          rotation: { x: 0, y: 0, z: 0 },
          parts: [{
            shape: 'box',
            dimensions: { width: 6, height: 0.15, depth: 1.5 },
            position: { x: 0, y: 0, z: 0 },
            color: counterColor,
            material: { roughness: 0.3, metalness: 0.0 }
          }]
        });
        
        // === STAINLESS STEEL BACKSPLASH ===
        const backsplashHeight = 1.5;
        const backsplashY = counterTopY + backsplashHeight / 2;
        
        // Backsplash on back wall (behind stove, with diagonal cut on left)
        data.structures.scanned_objects.push({
          name: 'backsplash_back',
          position: { x: -3, y: backsplashY, z: -roomSize / 2 + 0.1 },
          scale: 1,
          rotation: { x: 0, y: 0, z: 0 },
          parts: [{
            shape: 'box',
            dimensions: { width: 4, height: backsplashHeight, depth: 0.1 },
            position: { x: 0, y: 0, z: 0 },
            color: backsplashColor,
            material: { roughness: 0.2, metalness: 0.6 }
          }]
        });
        
        // Backsplash on right wall (behind sink)
        data.structures.scanned_objects.push({
          name: 'backsplash_right',
          position: { x: roomSize / 2 - 0.1, y: backsplashY, z: 0 },
          scale: 1,
          rotation: { x: 0, y: Math.PI / 2, z: 0 },
          parts: [{
            shape: 'box',
            dimensions: { width: 4, height: backsplashHeight, depth: 0.1 },
            position: { x: 0, y: 0, z: 0 },
            color: backsplashColor,
            material: { roughness: 0.2, metalness: 0.6 }
          }]
        });
        
        // === EXHAUST VENT (circular, in backsplash above stove) ===
        data.structures.scanned_objects.push({
          name: 'exhaust_vent',
          position: { x: -3, y: backsplashY + 0.3, z: -roomSize / 2 + 0.15 },
          scale: 1,
          rotation: { x: 0, y: 0, z: 0 },
          parts: [{
            shape: 'cylinder',
            dimensions: { radius: 0.4, height: 0.1 },
            position: { x: 0, y: 0, z: 0 },
            color: backsplashColor,
            material: { roughness: 0.3, metalness: 0.7 }
          }]
        });
        
        // === WHITE ELECTRIC STOVE (on back wall counter) ===
        data.structures.scanned_objects.push({
          name: 'stove',
          position: { x: -3, y: counterTopY, z: -roomSize / 2 + counterDepth / 2 },
          scale: 1,
          rotation: { x: 0, y: 0, z: 0 },
          parts: [{
            shape: 'box',
            dimensions: { width: 3.5, height: 0.5, depth: counterDepth - 0.1 },
            position: { x: 0, y: 0, z: 0 },
            color: stoveColor,
            material: { roughness: 0.6, metalness: 0.3 }
          }]
        });
        
        // === STAINLESS STEEL SINK (on right wall counter) ===
        data.structures.scanned_objects.push({
          name: 'sink',
          position: { x: roomSize / 2 - counterDepth / 2, y: counterTopY, z: 0 },
          scale: 1,
          rotation: { x: 0, y: Math.PI / 2, z: 0 },
          parts: [{
            shape: 'box',
            dimensions: { width: 2, height: 0.4, depth: 1.5 },
            position: { x: 0, y: 0, z: 0 },
            color: sinkColor,
            material: { roughness: 0.1, metalness: 0.8 }
          }]
        });
        
        // === UPPER CABINETS ===
        const upperCabinetY = upperCabinetBottom + upperCabinetHeight / 2;
        
        // Upper cabinets on back wall (three, like reference)
        data.structures.scanned_objects.push(
          {
            name: 'upper_cabinet_1',
            position: { x: -8, y: upperCabinetY, z: -roomSize / 2 + 0.3 },
            scale: 1,
            rotation: { x: 0, y: 0, z: 0 },
            parts: [{
              shape: 'box',
              dimensions: { width: 4, height: upperCabinetHeight, depth: 1.5 },
              position: { x: 0, y: 0, z: 0 },
              color: cabinetColor,
              material: { roughness: 0.7, metalness: 0.1 }
            }]
          },
          {
            name: 'upper_cabinet_2',
            position: { x: -3, y: upperCabinetY, z: -roomSize / 2 + 0.3 },
            scale: 1,
            rotation: { x: 0, y: 0, z: 0 },
            parts: [{
              shape: 'box',
              dimensions: { width: 4, height: upperCabinetHeight, depth: 1.5 },
              position: { x: 0, y: 0, z: 0 },
              color: cabinetColor,
              material: { roughness: 0.7, metalness: 0.1 }
            }]
          },
          {
            name: 'upper_cabinet_3',
            position: { x: 2, y: upperCabinetY, z: -roomSize / 2 + 0.3 },
            scale: 1,
            rotation: { x: 0, y: 0, z: 0 },
            parts: [{
              shape: 'box',
              dimensions: { width: 4, height: upperCabinetHeight, depth: 1.5 },
              position: { x: 0, y: 0, z: 0 },
              color: cabinetColor,
              material: { roughness: 0.7, metalness: 0.1 }
            }]
          }
        );
        
        // === WHITE REFRIGERATOR (at end of right wall) ===
        const refrigeratorY = (counterHeight + 2) / 2;
        data.structures.scanned_objects.push({
          name: 'refrigerator',
          position: { x: roomSize / 2 - 2, y: refrigeratorY, z: 5 },
          scale: 1,
          rotation: { x: 0, y: 0, z: 0 },
          parts: [{
            shape: 'box',
            dimensions: { width: 2.5, height: counterHeight + 2, depth: 2.5 },
            position: { x: 0, y: 0, z: 0 },
            color: refrigeratorColor,
            material: { roughness: 0.8, metalness: 0.2 }
          }]
        });
        
        // === CEILING LIGHT (rectangular surface-mounted fluorescent) ===
        data.structures.scanned_objects.push({
          name: 'ceiling_light',
          position: { x: 0, y: wallHeight - 0.15, z: 0 },
          scale: 1,
          rotation: { x: 0, y: 0, z: 0 },
          parts: [{
            shape: 'box',
            dimensions: { width: 6, height: 0.3, depth: 2 },
            position: { x: 0, y: 0, z: 0 },
            color: 0xFFFFFF,
            material: { roughness: 0.1, metalness: 0.0, emissive: 0xFFFFFF, emissiveIntensity: 0.8 }
          }]
        });
        
        // === WHITE PVC PIPES (near ceiling, left wall) ===
        data.structures.scanned_objects.push({
          name: 'pvc_pipe',
          position: { x: -roomSize / 2 + 0.5, y: wallHeight - 1, z: -8 },
          scale: 1,
          rotation: { x: 0, y: 0, z: Math.PI / 2 },
          parts: [{
            shape: 'cylinder',
            dimensions: { radius: 0.15, height: 4 },
            position: { x: 0, y: 0, z: 0 },
            color: 0xFFFFFF,
            material: { roughness: 0.6, metalness: 0.0 }
          }]
        });
        
        // === OPTIONAL DETAILS: Coffee maker, laptop on left counter ===
        // Coffee maker (black, on left counter)
        data.structures.scanned_objects.push({
          name: 'coffee_maker',
          position: { x: -9, y: counterTopY + 0.3, z: 5 },
          scale: 1,
          rotation: { x: 0, y: 0, z: 0 },
          parts: [{
            shape: 'box',
            dimensions: { width: 0.8, height: 0.6, depth: 0.6 },
            position: { x: 0, y: 0, z: 0 },
            color: 0x000000,
            material: { roughness: 0.7, metalness: 0.2 }
          }]
        });
        
        // Laptop (on left counter)
        data.structures.scanned_objects.push({
          name: 'laptop',
          position: { x: -7, y: counterTopY + 0.1, z: 5 },
          scale: 1,
          rotation: { x: 0, y: 0, z: 0 },
          parts: [{
            shape: 'box',
            dimensions: { width: 1.2, height: 0.05, depth: 0.8 },
            position: { x: 0, y: 0, z: 0 },
            color: 0x1a1a1a,
            material: { roughness: 0.5, metalness: 0.3 }
          }]
        });
        
        console.log('[SCAN] ✅ Detailed kitchen created with L-shaped layout, cabinets, countertops, stove, sink, backsplash with vent, refrigerator, ceiling light, and details');
      } else {
        // Basic room (no kitchen) - no windows for kitchen
        console.log('[SCAN] ✅ Basic room created with walls, floor, and ceiling');
      }
    }
    
    // Set color palette from AI-generated palette if available
    if (data.world?.color_palette && data.world.color_palette.length > 0) {
      console.log('[SCAN] Setting color palette:', data.world.color_palette);
      setColorPalette(data.world.color_palette);
    }
    
    const colorAssignments = data.world?.color_assignments || {};
    setCurrentWorld(data);
    
    // biomeName is already declared above for kitchen generation check
    createGround(scene, biomeName);

    if (data.world && data.world.lighting_config) {
      updateLighting(data.world.lighting_config, data.world.color_assignments);
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

    // Get plant_type from world data
    const plantType = data.world?.plant_type || "tree";
    console.log(`[OVERSHOOT] Plant type for this world: ${plantType}`);

    // Load structures (same logic as captureAndScanWorld)
    if (data.structures) {
      if (data.structures.trees) {
        console.log(`[OVERSHOOT] Creating ${data.structures.trees.length} plants (type: ${plantType})...`);
        data.structures.trees.forEach((treeData) => {
          const scale = treeData.scale || 1.0;
          let plantRadius;
          if (plantType === "cactus") {
            plantRadius = 1.5 * scale + 1;
          } else if (plantType === "creepy_plant") {
            plantRadius = 2 * scale + 1;
          } else {
          const leafSize = treeData.leafless ? 3 * scale : 2.2 * scale;
          const randomOffset = 0.6 * scale;
            plantRadius = leafSize + randomOffset + 1;
          }
          
          if (!checkRadiusClear(
            treeData.position.x,
            treeData.position.z,
            plantRadius,
            terrainPlacementMaskRef.current
          )) {
            return;
          }

          // Apply AI-generated colors from color_assignments if available
          const plantDataWithColors = {
            ...treeData,
            leaf_color: treeData.leaf_color || colorAssignments.tree_leaves || colorAssignments.tree_leaves_light,
            trunk_color: treeData.trunk_color || colorAssignments.tree_trunk
          };

          const plant = createPlant(plantDataWithColors, plantType);
          const terrainY = getHeightAt(treeData.position.x, treeData.position.z);
          const finalY = treeData.position.y !== 0 ? treeData.position.y : terrainY;
          plant.position.set(treeData.position.x, finalY, treeData.position.z);
          
          plant.userData = { 
            structureType: 'tree',
            plantType: plantType,
            scale: treeData.scale || 1.0,
            leafless: treeData.leafless || false
          };
          scene.add(plant);
          structuresRef.current.push(plant);
          
          markRadiusOccupied(
            treeData.position.x,
            treeData.position.z,
            plantRadius,
            terrainPlacementMaskRef.current
          );
        });
        console.log(`[OVERSHOOT] ✅ Added ${structuresRef.current.filter(obj => obj.userData.structureType === 'tree').length} plants (type: ${plantType})`);
      }

      // Add clouds
      const cloudCount = 15;
      const minCloudDistance = 80;
      const cloudPositions = [];
      
      for (let i = 0; i < cloudCount; i++) {
        let attempts = 0;
        let validPosition = false;
        let x, y, z, scale;
        
        while (!validPosition && attempts < 50) {
          x = (Math.random() - 0.5) * 500;
          y = 60 + Math.random() * 90;
          z = (Math.random() - 0.5) * 600;
          scale = 3 + Math.random() * 2;
          
          let tooClose = false;
          for (const existingPos of cloudPositions) {
            const dist = Math.sqrt(
              (x - existingPos.x) ** 2 + 
              (y - existingPos.y) ** 2 + 
              (z - existingPos.z) ** 2
            );
            const requiredDistance = minCloudDistance * (scale / 3);
            if (dist < requiredDistance) {
              tooClose = true;
              break;
            }
          }
          
          if (!tooClose) {
            validPosition = true;
          }
          attempts++;
        }
        
        if (!validPosition) continue;
        
        const cloud = createCloud(x, y, z, scale, biomeName);
        scene.add(cloud);
        cloudPositions.push({ x, y, z, scale });
      }

      if (data.structures.rocks) {
        data.structures.rocks.forEach(rockData => {
          // Apply AI-generated colors from color_assignments
          const rock = createRock(rockData, colorAssignments);
          rock.userData = { structureType: 'rock' };
          scene.add(rock);
          structuresRef.current.push(rock);
        });
        console.log(`[OVERSHOOT] ✅ Added ${data.structures.rocks.length} rocks`);
      }
      
      // Mountains are now part of the terrain mesh, not separate structures
      // Skip rendering separate peak meshes
      if (data.structures.peaks && data.structures.peaks.length > 0) {
        console.log(`[OVERSHOOT] Skipping ${data.structures.peaks.length} peaks - mountains are now part of terrain mesh`);
      }

      if (data.structures.buildings) {
        data.structures.buildings.forEach((buildingData, idx) => {
          const gridIndex = Math.floor(
            idx / (buildingGridConfig.gridSizeX * buildingGridConfig.gridSizeZ)
          );
          const localIndex = idx % (buildingGridConfig.gridSizeX * buildingGridConfig.gridSizeZ);
          const gridOrigin = buildingGridOrigins[gridIndex % buildingGridOrigins.length];
          const buildingType = getBuildingTypeForBiome(biomeName, idx);

          const building = createBuilding(
            buildingData,
            localIndex,
            buildingType,
            gridOrigin
          );

          building.userData = {
            ...building.userData,
            structureType: 'building',
            buildingType,
          };

          scene.add(building);
          structuresRef.current.push(building);
        });

        // Mark building locations as occupied
        data.structures.buildings.forEach((buildingData, idx) => {
          const gridIndex = Math.floor(idx / (buildingGridConfig.gridSizeX * buildingGridConfig.gridSizeZ));
          const localIndex = idx % (buildingGridConfig.gridSizeX * buildingGridConfig.gridSizeZ);
          const gridOrigin = buildingGridOrigins[gridIndex % buildingGridOrigins.length];
          const gridPos = getBuildingGridPosition(localIndex, buildingGridConfig, gridOrigin);

          const buildingWidth = (buildingData.width || 4) * 2;
          const buildingDepth = (buildingData.depth || 4) * 2;
          const buildingRadius = Math.max(buildingWidth, buildingDepth) / 2 + 2;
          
          markRadiusOccupied(
            gridPos.x,
            gridPos.z,
            buildingRadius,
            terrainPlacementMaskRef.current
          );
        });
      }

      if (data.structures.street_lamps) {
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
        
        data.structures.street_lamps.forEach(lampData => {
          const lamp = createStreetLamp(lampData, shouldGlow);
          lamp.userData = { structureType: 'street_lamp' };
          scene.add(lamp);
          structuresRef.current.push(lamp);
        });
        console.log(`[OVERSHOOT] ✅ Added ${data.structures.street_lamps.length} street lamps`);
      }

      if (data.structures.creative_objects) {
        data.structures.creative_objects.forEach(objData => {
          try {
            const creativeObj = createCreativeObject(objData);
            scene.add(creativeObj);
            structuresRef.current.push(creativeObj);
          } catch (error) {
            console.error(`[OVERSHOOT] Error creating creative object:`, error, objData);
          }
        });
      }

      // Handle room walls (for indoor/room biome)
      if (data.structures.walls) {
        console.log(`[OVERSHOOT] Creating ${data.structures.walls.length} room walls...`);
        data.structures.walls.forEach(wallData => {
          const wall = createRoomWall(wallData);
          wall.userData = { structureType: wallData.type || 'wall' };
          scene.add(wall);
          structuresRef.current.push(wall);
        });
        console.log(`[OVERSHOOT] ✅ Added ${data.structures.walls.length} room walls/floor`);
      }
      
      // Handle windows (transparent glass panels)
      if (data.structures.windows) {
        console.log(`[OVERSHOOT] Creating ${data.structures.windows.length} windows...`);
        data.structures.windows.forEach(windowData => {
          const window = createRoomWall(windowData);
          window.userData = { structureType: 'window' };
          scene.add(window);
          structuresRef.current.push(window);
        });
        console.log(`[OVERSHOOT] ✅ Added ${data.structures.windows.length} windows`);
      }

      // Handle scanned objects (coffee maker, paper towel, etc.)
      if (data.structures.scanned_objects) {
        console.log(`[OVERSHOOT] Creating ${data.structures.scanned_objects.length} scanned objects...`);
        data.structures.scanned_objects.forEach(objData => {
          try {
            const scannedObj = createScannedObject(objData);
            scannedObj.userData = { 
              structureType: 'scanned_object',
              originalName: objData.original_name || objData.name
            };
            scene.add(scannedObj);
            structuresRef.current.push(scannedObj);
          } catch (error) {
            console.error(`[OVERSHOOT] Error creating scanned object:`, error, objData);
          }
        });
        console.log(`[OVERSHOOT] ✅ Added ${data.structures.scanned_objects.length} scanned objects`);
      }
    }

    // Determine spawn location
    let spawn = data.spawn_point || { x: 0, z: 0 };
    let spawnY = null;
    
    const spawnBiomeName = data.world?.biome || data.world?.biome_name;
    if (spawnBiomeName && spawnBiomeName.toLowerCase() === 'city') {
      const buildings = structuresRef.current.filter(
        s => s.userData?.structureType === 'building'
      );
      
      if (buildings.length > 0) {
        const building = buildings[Math.floor(Math.random() * buildings.length)];
        const buildingHeight = building.userData?.buildingHeight || 0;
        spawn = {
          x: building.position.x,
          z: building.position.z
        };
        spawnY = building.position.y + buildingHeight + 2;
      }
    }
    
    const playerMesh = createPlayer(spawn, spawnY);
    playerRef.current = playerMesh;
    scene.add(playerMesh);

    // Load enemies
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
  };

  const handleCameraError = (error) => {
    let errorMessage = 'Could not access camera.\n\n';
    
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      errorMessage += 'Camera permission was denied.\n\n' +
        'SOLUTION:\n' +
        '1. Click the lock/camera icon in your browser address bar\n' +
        '2. Find "Camera" → Change to "Allow"\n' +
        '3. Reload the page and try again\n\n' +
        'IMPORTANT: If using IP address, switch to:\n' +
        'http://localhost:3000';
    } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      errorMessage += 'No camera found.\n\nPlease connect a camera and try again.';
    } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      errorMessage += 'Camera is already in use.\n\n' +
        'Please close other applications using the camera and try again.';
    } else {
      errorMessage += `Error: ${error.name}\n\n${error.message}\n\n` +
        'SOLUTION: Try accessing via http://localhost:3000 instead of IP address.';
    }
    
    alert(errorMessage);
  };

  const stopCameraCapture = async () => {
    console.log('[STREAMING] Stopping all capture...');
    
    // Stop frame capture interval (fallback mode)
    if (streamingIntervalRef.current) {
      clearInterval(streamingIntervalRef.current);
      streamingIntervalRef.current = null;
      console.log('[STREAMING] Frame capture interval stopped');
    }
    
    // Stop Overshoot SDK RealtimeVision
    if (overshootVisionRef.current) {
      try {
        // Check if it's the actual Overshoot SDK or our fallback object
        if (typeof overshootVisionRef.current.stop === 'function') {
        await overshootVisionRef.current.stop();
          console.log('[OVERSHOOT] RealtimeVision stopped');
        }
      } catch (error) {
        console.log('[OVERSHOOT] Stop error (ignored):', error.message);
      }
      overshootVisionRef.current = null;
    }
    
    // Capture video frame BEFORE stopping stream (for world generation)
    let imageDataForGeneration = null;
    if (latestScanDataRef.current && !worldGeneratedFromScanRef.current && gameState !== GameState.PLAYING) {
      if (videoRef.current && videoRef.current.videoWidth > 0) {
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoRef.current, 0, 0);
        imageDataForGeneration = canvas.toDataURL('image/jpeg', 0.7);
      }
    }
    
    // Stop camera stream
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
      console.log('[STREAMING] Camera stream stopped');
    }
    
    setStreamingActive(false);
    setScanMode(false);
    
    // Trigger generate function with "kitchen" search when streaming stops
    if (latestScanDataRef.current && !worldGeneratedFromScanRef.current && gameState !== GameState.PLAYING) {
      const scanData = latestScanDataRef.current;
      
      // Log the scene description to console (as requested)
      console.log(`[STREAMING] 📝 Scene Description:`);
      console.log(`[STREAMING] ${scanData.sceneDescription}`);
      console.log(`[STREAMING] 🎬 Triggering generateWorld with search "kitchen"...`);
      
      // Mark as generated to prevent multiple calls
      worldGeneratedFromScanRef.current = true;
      
      // Call generateWorld with "kitchen" as the search/prompt
      generateWorld('kitchen');
    }
    
    setLastScanResult(null);
    console.log('[STREAMING] All capture stopped');
  };

  const captureAndScanWorld = async () => {
    if (!videoRef.current) return;
    
    // Capture current video frame
    const canvas = document.createElement('canvas');
    const videoWidth = videoRef.current.videoWidth || 640;
    const videoHeight = videoRef.current.videoHeight || 480;
    
    if (videoWidth === 0 || videoHeight === 0) {
      alert('Video not ready yet. Please wait for the camera to initialize.');
      return;
    }
    
    canvas.width = videoWidth;
    canvas.height = videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoRef.current, 0, 0, videoWidth, videoHeight);
    
    // Convert to base64
    const imageData = canvas.toDataURL('image/jpeg', 0.8);
    
    console.log('[SCAN] Captured image, sending to backend...');
    console.log('[SCAN] Image data length:', imageData.length, 'characters');
    console.log('[SCAN] Video dimensions:', videoWidth, 'x', videoHeight);
    
    if (!imageData || imageData.length < 100) {
      alert('Failed to capture image. Please try again.');
      return;
    }
    setGameState(GameState.GENERATING);
    stopCameraCapture();
    
    try {
      const res = await fetch(`${API_BASE}/scan-world`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_data: imageData }),
      });
      
      
      if (!res.ok) {
        const errorText = await res.text();
        console.error('[SCAN] API Error Response:', errorText);
        
        // Try to parse as JSON for better error message
        let errorDetail = errorText;
        try {
          const errorJson = JSON.parse(errorText);
          errorDetail = errorJson.detail || errorText;
        } catch (e) {
          // Not JSON, use as-is
        }
        
        throw new Error(`Scan failed: ${res.status}\n\n${errorDetail}`);
      }
      
      const data = await res.json();
      console.log('[SCAN] World generated from scan:', data);
      
      // Set color palette from AI-generated palette if available
      if (data.world?.color_palette && data.world.color_palette.length > 0) {
        console.log('[SCAN] Setting AI-generated color palette:', data.world.color_palette);
        setColorPalette(data.world.color_palette);
      }
      
      // Use the same world loading logic as generateWorld
      // Since generateWorld does all loading inline, we'll do the same here
      // The scan response format matches generate-world response format
      
      // Simply delegate to generateWorld's loading by calling a helper
      // Actually, let's just set currentWorld and let the existing logic handle it
      // But generateWorld loads inline, so we need to replicate...
      
      // For now, let's create a helper that both can use, or just duplicate the logic
      // Simplest: call the same loading code inline like generateWorld does
      
      // Get AI-generated color assignments for structures
      const colorAssignments = data.world?.color_assignments || {};
      
      setCurrentWorld(data);
      
      const scene = sceneRef.current;
      if (!scene) {
        console.error('[SCAN] Scene not available');
        setGameState(GameState.IDLE);
        return;
      }

      const biomeName = data.world?.biome || data.world?.biome_name;
      createGround(scene, biomeName);

      // Clear existing objects (same as generateWorld)
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
        console.log('[SCAN] Applying lighting:', data.world.lighting_config);
        // Pass color_assignments to updateLighting so sky uses AI-generated color
        updateLighting(data.world.lighting_config, data.world.color_assignments);
      }

      if (data.world && data.world.heightmap_raw && data.world.colour_map_array) {
        heightmapRef.current = data.world.heightmap_raw;
        colorMapRef.current = data.world.colour_map_array;
        terrainPlacementMaskRef.current = heightmapRef.current.map(row =>
          row.map(height => (height >= 0 ? 1 : 0))
        );
        
        // Create terrain mesh
        const terrainMesh = createTerrain(heightmapRef.current, colorMapRef.current, 256);
        terrainMeshRef.current = terrainMesh;
        scene.add(terrainMesh);
      }

      // Get plant_type from world data
      const plantType = data.world?.plant_type || "tree";
      console.log(`[SCAN] Plant type for this world: ${plantType}`);

      // Load structures (same as generateWorld)
      if (data.structures) {
        if (data.structures.trees) {
          console.log(`[SCAN] Creating ${data.structures.trees.length} plants (type: ${plantType})...`);
          data.structures.trees.forEach((treeData) => {
            const scale = treeData.scale || 1.0;
            let plantRadius;
            if (plantType === "cactus") {
              plantRadius = 1.5 * scale + 1;
            } else if (plantType === "creepy_plant") {
              plantRadius = 2 * scale + 1;
            } else {
            const leafSize = treeData.leafless ? 3 * scale : 2.2 * scale;
            const randomOffset = 0.6 * scale;
              plantRadius = leafSize + randomOffset + 1;
            }
            
            if (!checkRadiusClear(
              treeData.position.x,
              treeData.position.z,
              plantRadius,
              terrainPlacementMaskRef.current
            )) {
              return;
            }

            // Apply AI-generated colors from color_assignments if available
            const plantDataWithColors = {
              ...treeData,
              leaf_color: treeData.leaf_color || colorAssignments.tree_leaves || colorAssignments.tree_leaves_light,
              trunk_color: treeData.trunk_color || colorAssignments.tree_trunk
            };

            const plant = createPlant(plantDataWithColors, plantType);
            const terrainY = getHeightAt(treeData.position.x, treeData.position.z);
            const finalY = treeData.position.y !== 0 ? treeData.position.y : terrainY;
            plant.position.set(treeData.position.x, finalY, treeData.position.z);
            
            plant.userData = { 
              structureType: 'tree',
              plantType: plantType,
              scale: treeData.scale || 1.0,
              leafless: treeData.leafless || false
            };
            scene.add(plant);
            structuresRef.current.push(plant);
            
            markRadiusOccupied(
              treeData.position.x,
              treeData.position.z,
              plantRadius,
              terrainPlacementMaskRef.current
            );
          });
          console.log(`[SCAN] ✅ Added ${structuresRef.current.filter(obj => obj.userData.structureType === 'tree').length} plants (type: ${plantType})`);
        }

        // Add clouds
        const cloudCount = 15;
        const minCloudDistance = 80;
        const cloudPositions = [];
        
        for (let i = 0; i < cloudCount; i++) {
          let attempts = 0;
          let validPosition = false;
          let x, y, z, scale;
          
          while (!validPosition && attempts < 50) {
            x = (Math.random() - 0.5) * 500;
            y = 60 + Math.random() * 90;
            z = (Math.random() - 0.5) * 600;
            scale = 3 + Math.random() * 2;
            
            let tooClose = false;
            for (const existingPos of cloudPositions) {
              const dist = Math.sqrt(
                (x - existingPos.x) ** 2 + 
                (y - existingPos.y) ** 2 + 
                (z - existingPos.z) ** 2
              );
              const requiredDistance = minCloudDistance * (scale / 3);
              if (dist < requiredDistance) {
                tooClose = true;
                break;
              }
            }
            
            if (!tooClose) {
              validPosition = true;
            }
            attempts++;
          }
          
          if (!validPosition) continue;
          
          const cloud = createCloud(x, y, z, scale, biomeName);
          scene.add(cloud);
          cloudPositions.push({ x, y, z, scale });
        }

        if (data.structures.rocks) {
          data.structures.rocks.forEach(rockData => {
            // Apply AI-generated colors from color_assignments
            const rock = createRock(rockData, colorAssignments);
            rock.userData = { structureType: 'rock' };
            scene.add(rock);
            structuresRef.current.push(rock);
          });
          console.log(`[SCAN] ✅ Added ${data.structures.rocks.length} rocks`);
        }
        
        // Mountains are now part of the terrain mesh, not separate structures
        if (data.structures.peaks && data.structures.peaks.length > 0) {
          console.log(`[SCAN] Skipping ${data.structures.peaks.length} peaks - mountains are now part of terrain mesh`);
        }

        if (data.structures.buildings) {
          data.structures.buildings.forEach((buildingData, idx) => {
            const gridIndex = Math.floor(
              idx / (buildingGridConfig.gridSizeX * buildingGridConfig.gridSizeZ)
            );
            const localIndex = idx % (buildingGridConfig.gridSizeX * buildingGridConfig.gridSizeZ);
            const gridOrigin = buildingGridOrigins[gridIndex % buildingGridOrigins.length];
            const buildingType = getBuildingTypeForBiome(biomeName, idx);

            const building = createBuilding(
              buildingData,
              localIndex,
              buildingType,
              gridOrigin
            );

            building.userData = {
              ...building.userData,
              structureType: 'building',
              buildingType,
            };

            scene.add(building);
            structuresRef.current.push(building);
          });

          // Mark building locations as occupied
          data.structures.buildings.forEach((buildingData, idx) => {
            const gridIndex = Math.floor(idx / (buildingGridConfig.gridSizeX * buildingGridConfig.gridSizeZ));
            const localIndex = idx % (buildingGridConfig.gridSizeX * buildingGridConfig.gridSizeZ);
            const gridOrigin = buildingGridOrigins[gridIndex % buildingGridOrigins.length];
            const gridPos = getBuildingGridPosition(localIndex, buildingGridConfig, gridOrigin);

            const buildingWidth = (buildingData.width || 4) * 2;
            const buildingDepth = (buildingData.depth || 4) * 2;
            const buildingRadius = Math.max(buildingWidth, buildingDepth) / 2 + 2;
            
            markRadiusOccupied(
              gridPos.x,
              gridPos.z,
              buildingRadius,
              terrainPlacementMaskRef.current
            );
          });
        }

        if (data.structures.street_lamps) {
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
          
          data.structures.street_lamps.forEach(lampData => {
            const lamp = createStreetLamp(lampData, shouldGlow);
            lamp.userData = { structureType: 'street_lamp' };
            scene.add(lamp);
            structuresRef.current.push(lamp);
          });
          console.log(`[SCAN] ✅ Added ${data.structures.street_lamps.length} street lamps`);
        }
      }

      // Determine spawn location
      let spawn = data.spawn_point || { x: 0, z: 0 };
      let spawnY = null;
      
      const spawnBiomeName = data.world?.biome || data.world?.biome_name;
      if (spawnBiomeName && spawnBiomeName.toLowerCase() === 'city') {
        const buildings = structuresRef.current.filter(
          s => s.userData?.structureType === 'building'
        );
        
        if (buildings.length > 0) {
          const building = buildings[Math.floor(Math.random() * buildings.length)];
          const buildingHeight = building.userData?.buildingHeight || 0;
          spawn = {
            x: building.position.x,
            z: building.position.z
          };
          spawnY = building.position.y + buildingHeight + 2;
        }
      }
      
      const playerMesh = createPlayer(spawn, spawnY);
      playerRef.current = playerMesh;
      scene.add(playerMesh);

      // Load enemies
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
      
    } catch (error) {
      console.error('[SCAN ERROR]:', error);
      
      let errorMessage = 'Failed to generate world from scan.\n\n';
      
      if (error.message.includes('OVERSHOOT') || error.message.includes('API key')) {
        errorMessage += '⚠️ OVERSHOOT AI API NOT CONFIGURED\n\n' +
          'The scan feature requires an Overshoot AI API key.\n\n' +
          'SOLUTION:\n' +
          '1. Get your Overshoot AI API key from https://cluster1.overshoot.ai/api/v0.2\n' +
          '2. Add to backend/.env file:\n' +
          '   OVERSHOOT_API_KEY=your_api_key_here\n' +
          '3. Restart the backend server\n\n' +
          'For now, you can use voice/text prompts to generate worlds.';
      } else if (error.message.includes('Failed to analyze')) {
        errorMessage += '⚠️ IMAGE ANALYSIS FAILED\n\n' +
          'The backend could not analyze the captured image.\n\n' +
          'Check the backend console for detailed error messages.\n\n' +
          'Possible causes:\n' +
          '- Overshoot API key missing or invalid\n' +
          '- Network connectivity issues\n' +
          '- Invalid API endpoint';
      } else {
        errorMessage += `Error: ${error.message}\n\n` +
          'Check the browser console (F12) and backend terminal for details.';
      }
      
      alert(errorMessage);
      setGameState(GameState.IDLE);
    }
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

      // Set color palette from AI-generated palette if available
      if (data.world?.color_palette && data.world.color_palette.length > 0) {
        console.log('[FRONTEND] Setting AI-generated color palette:', data.world.color_palette);
        setColorPalette(data.world.color_palette);
      }

      // Debug: Check color_assignments
      if (data.world?.color_assignments) {
        console.log('[FRONTEND] ✅ Color assignments received:', {
          keys: Object.keys(data.world.color_assignments),
          sky: data.world.color_assignments.sky,
          tree_leaves: data.world.color_assignments.tree_leaves,
          tree_trunk: data.world.color_assignments.tree_trunk,
          building: data.world.color_assignments.building,
          mountain: data.world.color_assignments.mountain,
          rock: data.world.color_assignments.rock
        });
      } else {
        console.log('[FRONTEND] ⚠️ WARNING: No color_assignments in response!');
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
        // Pass color_assignments to updateLighting so sky uses AI-generated color
        updateLighting(data.world.lighting_config, data.world.color_assignments);
        // updateLighting now handles northern lights automatically based on lighting_config.northern_lights flag
      }

      if (data.world && data.world.heightmap_raw && data.world.colour_map_array) {
        heightmapRef.current = data.world.heightmap_raw;
        colorMapRef.current = data.world.colour_map_array;
        terrainPlacementMaskRef.current = heightmapRef.current.map(row =>
          row.map(height => (height >= 0 ? 1 : 0))
        );
        
        // Create terrain mesh (roads will be added after buildings are placed)
        const terrainMesh = createTerrain(heightmapRef.current, colorMapRef.current, 256);
        terrainMeshRef.current = terrainMesh;
        scene.add(terrainMesh);
      }

      // Get AI-generated color assignments for structures
      const colorAssignments = data.world?.color_assignments || {};
      
      // Get plant_type from world data
      const plantType = data.world?.plant_type || "tree";
      console.log(`[FRONTEND] Plant type for this world: ${plantType}`);

      if (data.structures) {
        if (data.structures.trees) {
          console.log(`[FRONTEND] Creating ${data.structures.trees.length} plants (type: ${plantType})...`);
          data.structures.trees.forEach((treeData) => {
            // Calculate plant radius based on type and scale
            const scale = treeData.scale || 1.0;
            let plantRadius;
            if (plantType === "cactus") {
              plantRadius = 1.5 * scale + 1;
            } else if (plantType === "creepy_plant") {
              plantRadius = 2 * scale + 1;
            } else {
              // Default tree
            const leafSize = treeData.leafless ? 3 * scale : 2.2 * scale;
            const randomOffset = 0.6 * scale;
              plantRadius = leafSize + randomOffset + 1;
            }
            
            // Check if radius around plant position is clear
            if (!checkRadiusClear(
              treeData.position.x,
              treeData.position.z,
              plantRadius,
              terrainPlacementMaskRef.current
            )) {
              return; // Skip this plant if radius is occupied
            }

            // Apply AI-generated colors from color_assignments if available
            const plantDataWithColors = {
              ...treeData,
              leaf_color: treeData.leaf_color || colorAssignments.tree_leaves || colorAssignments.tree_leaves_light,
              trunk_color: treeData.trunk_color || colorAssignments.tree_trunk
            };

            const plant = createPlant(plantDataWithColors, plantType);
            const terrainY = getHeightAt(treeData.position.x, treeData.position.z);
            const finalY = treeData.position.y !== 0 ? treeData.position.y : terrainY;
            plant.position.set(treeData.position.x, finalY, treeData.position.z);
            
            plant.userData = { 
              structureType: 'tree',
              plantType: plantType,
              scale: treeData.scale || 1.0,
              leafless: treeData.leafless || false
            };
            scene.add(plant);
            structuresRef.current.push(plant);
            
            // Mark radius around plant as occupied
            markRadiusOccupied(
              treeData.position.x,
              treeData.position.z,
              plantRadius,
              terrainPlacementMaskRef.current
            );
          });
          console.log(`✅ Added ${structuresRef.current.filter(obj => obj.userData.structureType === 'tree').length} plants (type: ${plantType})`);
        }

        const cloudCount = 15;
        const minCloudDistance = 80; // Minimum distance between clouds to prevent clumping
        const cloudPositions = []; // Track cloud positions for spacing
        
        for (let i = 0; i < cloudCount; i++) {
          let attempts = 0;
          let validPosition = false;
          let x, y, z, scale;
          
          // Try to find a position that's not too close to other clouds
          while (!validPosition && attempts < 50) {
            x = (Math.random() - 0.5) * 500;
            y = 60 + Math.random() * 90;
            z = (Math.random() - 0.5) * 600;
            scale = 3 + Math.random() * 2;
            
            // Check distance from existing clouds
            let tooClose = false;
            for (const existingPos of cloudPositions) {
              const dist = Math.sqrt(
                (x - existingPos.x) ** 2 + 
                (y - existingPos.y) ** 2 + 
                (z - existingPos.z) ** 2
              );
              // Account for cloud scale - larger clouds need more space
              const requiredDistance = minCloudDistance * (scale / 3);
              if (dist < requiredDistance) {
                tooClose = true;
                break;
              }
            }
            
            if (!tooClose) {
              validPosition = true;
            }
            attempts++;
          }
          
          // If we couldn't find a perfect position after many attempts, skip this cloud
          if (!validPosition) {
            console.log('[CLOUDS] Skipping cloud placement: no valid position found after 50 attempts');
            continue;
          }
          
          const cloud = createCloud(x, y, z, scale, biomeName);
          scene.add(cloud);
          cloudPositions.push({ x, y, z, scale });
        }

        if (data.structures.rocks) {
          data.structures.rocks.forEach(rockData => {
            // Apply AI-generated colors from color_assignments
            const rock = createRock(rockData, colorAssignments);
            rock.userData = { structureType: 'rock' };
            scene.add(rock);
            structuresRef.current.push(rock);
          });
          console.log(`✅ Added ${data.structures.rocks.length} rocks`);
        }
        
        // Mountains are now part of the terrain mesh, not separate structures
        if (data.structures.peaks && data.structures.peaks.length > 0) {
          console.log(`Skipping ${data.structures.peaks.length} peaks - mountains are now part of terrain mesh`);
        }

        if (data.structures.creative_objects) {
          console.log(`[FRONTEND] Creating ${data.structures.creative_objects.length} creative objects...`);
          data.structures.creative_objects.forEach(objData => {
            try {
              // Log the full AI output
              console.log(`[FRONTEND] AI Output for "${objData.name || 'unnamed'}":`, JSON.stringify(objData, null, 2));
              console.log(`[FRONTEND] Parts breakdown:`, objData.parts?.map((p, i) => 
                `Part ${i+1}: ${p.shape} at y=${p.position?.y || 0}, color=${p.color || 'default'}`
              ));
              
              const creativeObj = createCreativeObject(objData);
              scene.add(creativeObj);
              structuresRef.current.push(creativeObj);
              console.log(`[FRONTEND] ✓ Created creative object: ${objData.name || 'unnamed'} at (${objData.position?.x?.toFixed(1)}, ${objData.position?.z?.toFixed(1)})`);
            } catch (error) {
              console.error(`[FRONTEND] Error creating creative object:`, error, objData);
            }
          });
          console.log(`✅ Added ${structuresRef.current.filter(obj => obj.userData.structureType === 'creative_object').length} creative objects`);
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

              // Pass color_assignments to building data so createBuilding can use them
              const buildingDataWithColors = {
                ...buildingData,
                _color_assignments: colorAssignments
              };

              const building = createBuilding(
                buildingDataWithColors,
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
          
          // Check if biome is city or futuristic/cyberpunk/superhero (all should have skyscrapers)
          const isUrbanBiome = currentBiomeName && (
            currentBiomeName.toLowerCase() === 'city' ||
            currentBiomeName.toLowerCase().includes('futuristic') ||
            currentBiomeName.toLowerCase().includes('cyberpunk') ||
            currentBiomeName.toLowerCase().includes('neon') ||
            currentBiomeName.toLowerCase().includes('spiderman') ||
            currentBiomeName.toLowerCase().includes('gotham') ||
            currentBiomeName.toLowerCase().includes('metropolis') ||
            currentBiomeName.toLowerCase().includes('superhero')
          );
          
          if (isUrbanBiome) {
            const biomeType = (currentBiomeName.toLowerCase().includes('futuristic') || 
                             currentBiomeName.toLowerCase().includes('cyberpunk')) ? 'futuristic' : 'city';
            const skyscraperCount = biomeType === 'futuristic' ? 5 : 3; // More skyscrapers for futuristic
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
              
              // If we couldn't find a valid position after many attempts, skip this skyscraper
              if (!validPosition) {
                console.log(`[SKYSCRAPERS] Skipping skyscraper ${i + 1}: no valid position found after ${attempts} attempts`);
                continue;
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
            console.log(`[SKYSCRAPERS] Biome is not city/futuristic/superhero (biomeName: ${biomeName}, data.world?.biome: ${data?.world?.biome}), skipping skyscraper creation`);
          }

        }
      }

      // Determine spawn location - on top of building if city/futuristic biome
      let spawn = data.spawn_point || { x: 0, z: 0 };
      let spawnY = null;
      
      const spawnBiomeName = data.world?.biome || data.world?.biome_name;
      const isUrbanSpawnBiome = spawnBiomeName && (
        spawnBiomeName.toLowerCase() === 'city' ||
        spawnBiomeName.toLowerCase().includes('futuristic') ||
        spawnBiomeName.toLowerCase().includes('cyberpunk') ||
        spawnBiomeName.toLowerCase().includes('neon')
      );
      if (isUrbanSpawnBiome) {
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

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab4e53c8-3e02-4665-bb8e-bc913babc9ea',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:5322',message:'Direct modification request',data:{method:'PATCH',payload:payload},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
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

      // Mountains are now part of terrain mesh, not separate structures
      // Skip peak removal - terrain regeneration will handle it
      if (newPeakCount < oldPeakCount) {
        console.log(`[MODIFY] Skipping peak removal - mountains are now part of terrain mesh`);
      }

      // Check if street lamps should be replaced (set operation when counts match)
      const shouldReplaceAllLamps = newStreetLampCount === oldStreetLampCount && newStreetLampCount > 0 && oldStreetLampCount > 0;
      
      if (shouldReplaceAllLamps) {
        // Replace all street lamps (for set operations)
        console.log(`[MODIFY] Replacing all ${oldStreetLampCount} street lamps...`);
        const lampsToRemove = structuresRef.current.filter(obj => obj.userData?.structureType === 'street_lamp');
        lampsToRemove.forEach(lamp => {
          scene.remove(lamp);
        });
        structuresRef.current = structuresRef.current.filter(obj => obj.userData?.structureType !== 'street_lamp');
        
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
        
        // Add all new street lamps
        data.structures.street_lamps.forEach(lampData => {
          const lamp = createStreetLamp(lampData, shouldGlow);
          lamp.userData = { structureType: 'street_lamp' };
          scene.add(lamp);
          structuresRef.current.push(lamp);
        });
        console.log(`[MODIFY] ✓ Successfully replaced ${data.structures.street_lamps.length} street lamps`);
      } else if (newStreetLampCount < oldStreetLampCount) {
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
        const plantType = data.world?.plant_type || currentWorld?.world?.plant_type || "tree";
        console.log(`[MODIFY] Adding ${newTrees.length} new plants (type: ${plantType})...`);

        newTrees.forEach(treeData => {
          // Calculate plant radius based on type and scale
          const scale = treeData.scale || 1.0;
          let plantRadius;
          if (plantType === "cactus") {
            plantRadius = 1.5 * scale + 1;
          } else if (plantType === "creepy_plant") {
            plantRadius = 2 * scale + 1;
          } else {
          const leafSize = treeData.leafless ? 3 * scale : 2.2 * scale;
          const randomOffset = 0.6 * scale;
            plantRadius = leafSize + randomOffset + 1;
          }
          
          // Check if radius around plant position is clear
          if (!checkRadiusClear(
            treeData.position.x,
            treeData.position.z,
            plantRadius,
            terrainPlacementMaskRef.current
          )) {
            return; // Skip this plant if radius is occupied
          }

          // Apply colors from color_assignments if available
          const colorAssignments = data.world?.color_assignments || currentWorld?.world?.color_assignments || {};
          const plantDataWithColors = {
            ...treeData,
            leaf_color: treeData.leaf_color || colorAssignments.tree_leaves || colorAssignments.tree_leaves_light,
            trunk_color: treeData.trunk_color || colorAssignments.tree_trunk
          };

          const plant = createPlant(plantDataWithColors, plantType);
          const terrainY = getHeightAt(treeData.position.x, treeData.position.z);
          const finalY = treeData.position.y !== 0 ? treeData.position.y : terrainY;
          plant.position.set(treeData.position.x, finalY, treeData.position.z);
          
          plant.userData = { 
            structureType: 'tree',
            plantType: plantType,
            scale: treeData.scale || 1.0,
            leafless: treeData.leafless || false
          };
          scene.add(plant);
          structuresRef.current.push(plant);
          
          // Mark radius around plant as occupied
          markRadiusOccupied(
            treeData.position.x,
            treeData.position.z,
            plantRadius,
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

      // Handle creative objects
      const oldCreativeObjectCount = structuresRef.current.filter(obj => obj.userData?.structureType === 'creative_object').length;
      const newCreativeObjectCount = data.structures?.creative_objects?.length || 0;
      
      if (data.structures?.creative_objects && newCreativeObjectCount > oldCreativeObjectCount) {
        const newCreativeObjects = data.structures.creative_objects.slice(oldCreativeObjectCount);
        console.log(`[MODIFY] Adding ${newCreativeObjects.length} creative objects...`);
        
        newCreativeObjects.forEach(objData => {
          try {
            // Log the full AI output
            console.log(`[MODIFY] AI Output for "${objData.name || 'unnamed'}":`, JSON.stringify(objData, null, 2));
            console.log(`[MODIFY] Parts breakdown:`, objData.parts?.map((p, i) => 
              `Part ${i+1}: ${p.shape} at y=${p.position?.y || 0}, color=${p.color || 'default'}`
            ));
            
            const creativeObj = createCreativeObject(objData);
            scene.add(creativeObj);
            structuresRef.current.push(creativeObj);
            console.log(`[MODIFY] ✓ Created creative object: ${objData.name || 'unnamed'} at (${objData.position?.x?.toFixed(1)}, ${objData.position?.z?.toFixed(1)})`);
          } catch (error) {
            console.error(`[MODIFY] Error creating creative object:`, error, objData);
          }
        });
      }
      
      if (newCreativeObjectCount < oldCreativeObjectCount) {
        const toRemove = oldCreativeObjectCount - newCreativeObjectCount;
        console.log(`[MODIFY] Removing ${toRemove} creative objects...`);
        for (let i = 0; i < toRemove; i++) {
          const creativeObj = structuresRef.current.find(obj => obj.userData?.structureType === 'creative_object');
          if (creativeObj) {
            scene.remove(creativeObj);
            structuresRef.current = structuresRef.current.filter(obj => obj !== creativeObj);
          }
        }
      }

      // Mountains are now part of terrain mesh, not separate structures
      // Skip peak addition - terrain regeneration will handle it
      if (data.structures?.peaks && newPeakCount > oldPeakCount) {
        console.log(`[MODIFY] Skipping peak addition - mountains are now part of terrain mesh`);
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
        // Pass color_assignments to updateLighting so sky uses AI-generated color
        updateLighting(data.world.lighting_config, data.world.color_assignments);
        // updateLighting now handles northern lights automatically based on lighting_config.northern_lights flag
      }

      if (data.physics) {
        console.log('[MODIFY] Updating physics...');
        playerState.current = { ...playerState.current, ...data.physics };
      }

      setCurrentWorld(data);
      
      // Add success message to the last conversation session if it exists
      setChatHistory(prev => {
        const updated = [...prev];
        const lastItem = updated[updated.length - 1];
        if (lastItem && lastItem.type === 'conversation' && lastItem.session) {
          // Add system message to the conversation session
          lastItem.session.push({
            role: 'system',
            content: '✅ Command executed successfully'
          });
        } else {
          // Fallback: add as separate system message
          updated.push({
        command: `✅ Command executed successfully`,
        timestamp: new Date().toLocaleTimeString(),
        type: 'system'
          });
        }
        return updated;
      });
      
      setGameState(GameState.PLAYING);
      console.log("✅ Modification complete, returned to PLAYING state");
      
      // Clear uploaded image after successful modification
      if (uploadedImage) {
        setUploadedImage(null);
        setImagePreview(null);
      }
    } catch (err) {
      console.error("Modify-world error:", err);
      // Add error message to the last conversation session if it exists
      setChatHistory(prev => {
        const updated = [...prev];
        const lastItem = updated[updated.length - 1];
        if (lastItem && lastItem.type === 'conversation' && lastItem.session) {
          // Add error message to the conversation session
          lastItem.session.push({
            role: 'system',
            content: `❌ Error: ${err.message}`
          });
        } else {
          // Fallback: add as separate error message
          updated.push({
        command: `❌ Error: ${err.message}`,
        timestamp: new Date().toLocaleTimeString(),
        type: 'error'
          });
        }
        return updated;
      });
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

  // Handle color palette changes from ColorPicker
  const handleColorPaletteChange = async (palette) => {
    console.log('[COLOR PICKER] Applying color palette:', palette);
    setColorPalette(palette);
    
    // Apply colors to current world if we have one
    if (currentWorld && gameState === GameState.PLAYING) {
      setColorSchemeNotification('Colour scheme is being implemented...');
      await applyColorPaletteToWorld(palette);
      setColorSchemeNotification('');
    }
  };

  // Apply color palette to terrain
  const applyColorPaletteToWorld = async (palette) => {
    if (!currentWorld || !palette || palette.length === 0) {
      console.warn('[COLOR PICKER] Cannot apply palette: missing world or palette');
      return;
    }

    try {
      const biome = currentWorld.world?.biome || currentWorld.world?.biome_name || 'default';
      const structure_counts = currentWorld.structures || {};
      
      console.log('[COLOR PICKER] Regenerating terrain with palette:', palette);
      console.log('[COLOR PICKER] Biome:', biome, 'Structures:', structure_counts);
      
      // Call backend to regenerate terrain with new colors
      const res = await fetch(`${API_BASE}/update-colors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          biome: biome,
          structures: structure_counts,
          color_palette: palette
        })
      });

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      const terrainData = await res.json();
      
      // Extract color assignments from response
      const colorAssignments = terrainData.color_assignments || {};
      console.log('[COLOR PICKER] Color assignments:', colorAssignments);
      
      // Update terrain with new colors
      const scene = sceneRef.current;
      if (!scene) {
        console.error('[COLOR PICKER] Scene not available');
        return;
      }

      console.log('[COLOR PICKER] Received terrain data:', {
        hasHeightmap: !!terrainData.heightmap_raw,
        hasColorMap: !!terrainData.colour_map_array,
        heightmapShape: terrainData.heightmap_raw ? `${terrainData.heightmap_raw.length}x${terrainData.heightmap_raw[0]?.length}` : 'none',
        colorMapShape: terrainData.colour_map_array ? `${terrainData.colour_map_array.length}x${terrainData.colour_map_array[0]?.length}` : 'none'
      });

      // Remove old terrain mesh - also search scene to ensure we remove it
      if (terrainMeshRef.current) {
        console.log('[COLOR PICKER] Removing old terrain mesh (by ref)');
        scene.remove(terrainMeshRef.current);
        if (terrainMeshRef.current.geometry) {
          terrainMeshRef.current.geometry.dispose();
        }
        if (terrainMeshRef.current.material) {
          if (terrainMeshRef.current.material.map) {
            terrainMeshRef.current.material.map.dispose();
          }
          terrainMeshRef.current.material.dispose();
        }
        terrainMeshRef.current = null;
      }
      
      // Also search scene for any terrain meshes and remove them (fallback)
      // Look for meshes with vertex colors (terrain characteristic)
      const terrainMeshes = scene.children.filter(child => {
        return child.isMesh && 
               child.material && 
               child.material.vertexColors && 
               child.geometry &&
               child.geometry.attributes.color && // Has color attribute
               !child.userData?.isSky && // Not the sky
               !child.userData?.isGround; // Not the ground plane
      });
      
      if (terrainMeshes.length > 0) {
        console.log(`[COLOR PICKER] Found ${terrainMeshes.length} potential terrain mesh(es) in scene, removing...`);
        terrainMeshes.forEach(mesh => {
          console.log('[COLOR PICKER] Removing terrain mesh:', {
            id: mesh.id,
            position: mesh.position.toArray(),
            rotation: mesh.rotation.toArray()
          });
          scene.remove(mesh);
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material) {
            if (mesh.material.map) mesh.material.map.dispose();
            mesh.material.dispose();
          }
        });
      }

      // Update refs with new terrain data
      if (terrainData.heightmap_raw && terrainData.colour_map_array) {
        console.log('[COLOR PICKER] Updating terrain refs and creating new mesh');
        console.log('[COLOR PICKER] Before update - terrain mesh count:', 
          scene.children.filter(c => c.isMesh && c.material?.vertexColors).length);
        
        // Store old color for comparison (before updating refs)
        const oldColorSample = colorMapRef.current?.[0]?.[0];
        
        heightmapRef.current = terrainData.heightmap_raw;
        colorMapRef.current = terrainData.colour_map_array;
        terrainPlacementMaskRef.current = terrainData.placement_mask || 
          heightmapRef.current.map(row => row.map(height => (height >= 0 ? 1 : 0)));
        
        // Log a sample of the new color data to verify it's different
        if (colorMapRef.current && colorMapRef.current[0] && colorMapRef.current[0][0]) {
          const newColorSample = colorMapRef.current[0][0];
          console.log('[COLOR PICKER] Color comparison:', {
            oldColor: oldColorSample,
            newColor: newColorSample,
            colorsChanged: oldColorSample ? JSON.stringify(oldColorSample) !== JSON.stringify(newColorSample) : 'N/A (no old color)'
          });
          console.log('[COLOR PICKER] Sample new color (first pixel):', newColorSample);
          console.log('[COLOR PICKER] Sample new color (middle pixel):', 
            colorMapRef.current[Math.floor(colorMapRef.current.length / 2)][Math.floor(colorMapRef.current[0].length / 2)]);
        }
        
        // Create new terrain mesh with updated colors
        const newTerrainMesh = createTerrain(
          heightmapRef.current,
          colorMapRef.current,
          256
        );
        
        if (!newTerrainMesh) {
          console.error('[COLOR PICKER] Failed to create terrain mesh');
          return;
        }
        
        // Ensure terrain is positioned correctly (should be at origin)
        // NOTE: createTerrain already rotates the geometry, so DON'T rotate the mesh again
        newTerrainMesh.position.set(0, 0, 0);
        // Don't set rotation.x - geometry is already rotated in createTerrain
        
        // Mark color attribute as needing update
        if (newTerrainMesh.geometry && newTerrainMesh.geometry.attributes.color) {
          newTerrainMesh.geometry.attributes.color.needsUpdate = true;
        }
        
        terrainMeshRef.current = newTerrainMesh;
        scene.add(newTerrainMesh);
        
        // Verify the new mesh has correct colors
        if (newTerrainMesh.geometry && newTerrainMesh.geometry.attributes.color) {
          const colorAttr = newTerrainMesh.geometry.attributes.color;
          const sampleIdx = Math.floor(colorAttr.count / 2);
          const firstIdx = 0;
          console.log('[COLOR PICKER] Terrain mesh color samples:', {
            firstVertex: {
              r: colorAttr.array[firstIdx * 3],
              g: colorAttr.array[firstIdx * 3 + 1],
              b: colorAttr.array[firstIdx * 3 + 2]
            },
            middleVertex: {
              r: colorAttr.array[sampleIdx * 3],
              g: colorAttr.array[sampleIdx * 3 + 1],
              b: colorAttr.array[sampleIdx * 3 + 2]
            },
            // Compare with color map array
            expectedFromColorMap: colorMapRef.current[0]?.[0],
            matches: colorAttr.array[firstIdx * 3] === colorMapRef.current[0]?.[0]?.[0] / 255 &&
                     colorAttr.array[firstIdx * 3 + 1] === colorMapRef.current[0]?.[0]?.[1] / 255 &&
                     colorAttr.array[firstIdx * 3 + 2] === colorMapRef.current[0]?.[0]?.[2] / 255
          });
        }
        
        console.log('[COLOR PICKER] After update - terrain mesh count:', 
          scene.children.filter(c => c.isMesh && c.material?.vertexColors).length);
        
        
        console.log('[COLOR PICKER] New terrain mesh added to scene:', {
          meshId: newTerrainMesh.id,
          position: newTerrainMesh.position.toArray(),
          rotation: newTerrainMesh.rotation.toArray(),
          visible: newTerrainMesh.visible,
          inScene: scene.children.includes(newTerrainMesh),
          hasColorAttribute: !!newTerrainMesh.geometry?.attributes?.color,
          colorCount: newTerrainMesh.geometry?.attributes?.color?.count || 0,
          sceneChildrenCount: scene.children.length
        });
        
        // Ensure the new terrain mesh is visible and properly positioned
        newTerrainMesh.visible = true;
        newTerrainMesh.updateMatrix();
        
        // Force render update - use requestAnimationFrame to ensure proper rendering
        if (rendererRef.current && cameraRef.current) {
          requestAnimationFrame(() => {
            if (rendererRef.current && cameraRef.current && sceneRef.current) {
              rendererRef.current.render(sceneRef.current, cameraRef.current);
              console.log('[COLOR PICKER] Forced render update after animation frame');
            }
          });
        }
        
        // Update sky/background color FIRST (before structures) - this should always happen if color_assignments exist
        const skyColorFromAssignments = colorAssignments?.sky;
        if (skyColorFromAssignments) {
          console.log('[COLOR PICKER] Updating sky color:', skyColorFromAssignments);
          
          // Update renderer clear color
          if (rendererRef.current) {
            const skyColor = new THREE.Color(skyColorFromAssignments);
            rendererRef.current.setClearColor(skyColor);
            console.log('[COLOR PICKER] Updated renderer clear color:', skyColorFromAssignments, 'RGB:', skyColor.r, skyColor.g, skyColor.b);
          }
          
          // Update sky mesh texture
          const skyMesh = scene.children.find(c => c.userData?.isSky);
          console.log('[COLOR PICKER] Looking for sky mesh:', {
            found: !!skyMesh,
            sceneChildrenCount: scene.children.length,
            skyMeshes: scene.children.filter(c => c.userData?.isSky).length
          });
          
          if (skyMesh && skyMesh.material) {
            const skyColor = new THREE.Color(skyColorFromAssignments);
            
            // Create gradient from sky color
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 512;
            const context = canvas.getContext('2d');
            const gradient = context.createLinearGradient(0, 0, 0, 512);
            
            // Create darker top and lighter bottom for gradient effect
            const topColor = new THREE.Color(skyColorFromAssignments);
            topColor.multiplyScalar(0.6); // Darker at top
            const bottomColor = new THREE.Color(skyColorFromAssignments);
            bottomColor.multiplyScalar(1.2); // Lighter at bottom
            
            gradient.addColorStop(0, `#${topColor.getHexString().padStart(6, '0')}`);
            gradient.addColorStop(0.5, skyColorFromAssignments);
            gradient.addColorStop(1, `#${bottomColor.getHexString().padStart(6, '0')}`);
            
            context.fillStyle = gradient;
            context.fillRect(0, 0, 512, 512);
            
            // Dispose old texture if it exists
            if (skyMesh.material.map) {
              skyMesh.material.map.dispose();
            }
            
            // Update sky texture
            const skyTexture = new THREE.CanvasTexture(canvas);
            skyMesh.material.map = skyTexture;
            skyMesh.material.needsUpdate = true;
            
            console.log('[COLOR PICKER] Updated sky mesh texture:', skyColorFromAssignments, {
              topColor: topColor.getHexString(),
              midColor: skyColor.getHexString(),
              bottomColor: bottomColor.getHexString()
            });
          } else {
            console.warn('[COLOR PICKER] Sky mesh not found or has no material:', {
              skyMesh: !!skyMesh,
              hasMaterial: skyMesh?.material ? true : false
            });
          }
          
          // Update ambient light color based on sky
          const ambientLight = scene.children.find(c => c.isAmbientLight);
          if (ambientLight) {
            const skyColor = new THREE.Color(skyColorFromAssignments);
            skyColor.multiplyScalar(0.8); // Darken slightly
            ambientLight.color.copy(skyColor);
            console.log('[COLOR PICKER] Updated ambient light color');
          }
        } else {
          console.warn('[COLOR PICKER] No sky color in color_assignments:', colorAssignments);
        }
        
        // Update structures with new colors from color_assignments
        if (colorAssignments && Object.keys(colorAssignments).length > 0) {
          console.log('[COLOR PICKER] Updating structure colors...');
          
          // Update tree colors
          structuresRef.current.forEach((structure) => {
            if (structure.userData?.structureType === 'tree') {
              const leafColor = colorAssignments.tree_leaves || '#228B22';
              const trunkColor = colorAssignments.tree_trunk || '#8b4513';
              
              // Update leaf colors
              structure.traverse((child) => {
                if (child.isMesh && child.material && child.material.vertexColors) {
                  const colorAttr = child.geometry.attributes.color;
                  if (colorAttr) {
                    const color = new THREE.Color(leafColor);
                    for (let i = 0; i < colorAttr.count; i++) {
                      colorAttr.setXYZ(i, color.r, color.g, color.b);
                    }
                    colorAttr.needsUpdate = true;
                  }
                } else if (child.isMesh && child.material && child.material.color) {
                  // Check if it's a trunk (standard material)
                  if (child.material.roughness > 1.0) { // Trunk has roughness > 1.0
                    child.material.color.set(trunkColor);
                  }
                }
              });
            } else if (structure.userData?.structureType === 'building') {
              const buildingColor = colorAssignments.building || '#FFB6C1';
              structure.traverse((child) => {
                if (child.isMesh && child.material && child.material.color) {
                  // Update building color, but keep windows darker
                  if (!child.material.map) { // Not a window (windows have textures)
                    child.material.color.set(buildingColor);
                  }
                }
              });
            } else if (structure.userData?.structureType === 'rock') {
              const rockColor = colorAssignments.rock || '#808080';
              structure.traverse((child) => {
                if (child.isMesh && child.material && child.material.color) {
                  child.material.color.set(rockColor);
                }
              });
            } else if (structure.userData?.structureType === 'mountain') {
              const mountainColor = colorAssignments.mountain || '#708090';
              structure.traverse((child) => {
                if (child.isMesh && child.material && child.material.color) {
                  child.material.color.set(mountainColor);
                }
              });
            }
          });
        }
        
        // Update current world with new terrain data and color assignments
        setCurrentWorld(prev => ({
          ...prev,
          world: {
            ...prev?.world,
            heightmap_raw: terrainData.heightmap_raw,
            colour_map_array: terrainData.colour_map_array,
            placement_mask: terrainData.placement_mask,
            color_assignments: colorAssignments
          }
        }));
        
        console.log('[COLOR PICKER] ✅ Terrain and structure colors updated successfully');
      } else {
        console.error('[COLOR PICKER] Missing terrain data:', {
          heightmap: !!terrainData.heightmap_raw,
          colorMap: !!terrainData.colour_map_array
        });
      }
    } catch (error) {
      console.error('[COLOR PICKER] Error applying color palette:', error);
      alert(`Failed to apply color palette: ${error.message}`);
    }
  };

  const updateLighting = (lightingConfig, colorAssignments = null) => {
    const scene = sceneRef.current;
    if (!scene || !lightingConfig) return;
    
    console.log('[FRONTEND LIGHTING] Updating scene lighting...', lightingConfig);
    
    // PRIORITY: Use AI-generated sky color from color_assignments if available
    // Check passed parameter first, then currentWorld state (in case of async state updates)
    const skyColorFromAssignments = colorAssignments?.sky || currentWorld?.world?.color_assignments?.sky;
    const effectiveBackgroundColor = skyColorFromAssignments || lightingConfig.background;
    
    console.log('[FRONTEND LIGHTING] Color assignments check:', {
      passed: !!colorAssignments,
      fromState: !!currentWorld?.world?.color_assignments,
      skyColor: skyColorFromAssignments,
      lightingBackground: lightingConfig.background,
      effective: effectiveBackgroundColor
    });
    
    if (skyColorFromAssignments) {
      console.log('[FRONTEND LIGHTING] ✅ Using AI-generated sky color:', skyColorFromAssignments);
    } else {
      console.log('[FRONTEND LIGHTING] ⚠️ No AI sky color, using lighting config background:', lightingConfig.background);
    }
    
    const ambientLight = scene.children.find(c => c.isAmbientLight);
    if (ambientLight && lightingConfig.ambient) {
      ambientLight.color.setStyle(lightingConfig.ambient.color || '#ffffff');
      ambientLight.intensity = lightingConfig.ambient.intensity ?? 0.8;
      console.log(`[FRONTEND LIGHTING] Ambient: ${lightingConfig.ambient.color} @ ${lightingConfig.ambient.intensity}`);
    }
    
    const directionalLight = scene.children.find(c => c.isDirectionalLight);
    if (directionalLight && lightingConfig.directional) {
      directionalLight.color.setStyle(lightingConfig.directional.color || '#ffffff');
      directionalLight.intensity = lightingConfig.directional.intensity ?? 0.8;
      if (lightingConfig.directional.position) {
      directionalLight.position.set(
          lightingConfig.directional.position.x ?? 50,
          lightingConfig.directional.position.y ?? 100,
          lightingConfig.directional.position.z ?? 50
        );
      }
      console.log(`[FRONTEND LIGHTING] Directional: ${lightingConfig.directional.color} @ ${lightingConfig.directional.intensity}`);
    }
    
    // Remove fog entirely (no fog in any biome)
    if (scene.fog) {
      scene.fog = null;
      console.log('[FRONTEND LIGHTING] Fog removed (disabled globally)');
    }
    
    // Handle northern lights based on lighting config or biome (arctic biomes always have northern lights)
    const hasLights = scene.children.some(c => c.userData?.isNorthernLights);
    const biomeName = currentWorld?.world?.biome || currentWorld?.world?.biome_name || '';
    const arcticBiomes = ['arctic', 'winter', 'icy', 'snow', 'frozen'];
    const isArctic = arcticBiomes.includes(biomeName.toLowerCase());
    const shouldHaveLights = lightingConfig.northern_lights === true || isArctic;
    
    if (shouldHaveLights && !hasLights) {
      console.log('[FRONTEND LIGHTING] Creating northern lights (config flag or arctic biome)');
      createNorthernLights(scene);
    } else if (!shouldHaveLights && hasLights) {
      console.log('[FRONTEND LIGHTING] Removing northern lights (not in lighting config and not arctic)');
      const lights = scene.children.filter(c => c.userData?.isNorthernLights);
      lights.forEach(light => scene.remove(light));
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
      
      // Parse the background color - USE AI-GENERATED SKY COLOR if available
      const bgColor = new THREE.Color(effectiveBackgroundColor);
      
      // Get HSL values
      const hsl = {};
      bgColor.getHSL(hsl);
      
      // Determine time of day based on lightness and adjust gradient accordingly
      const isNight = hsl.l < 0.3;
      let horizonColor, middleColor, topColor;
      
      // Check if it's city biome at noon for special gradient
      const biomeName = currentWorld?.world?.biome || currentWorld?.world?.biome_name;
      const timeOfDay = currentWorld?.world?.time;
      const isCityNoon = biomeName?.toLowerCase() === 'city' && 
                        (timeOfDay === 'noon' || hsl.l > 0.6);
      const isFuturistic = biomeName && (biomeName.toLowerCase().includes('futuristic') || 
                                         biomeName.toLowerCase().includes('cyberpunk') || 
                                         biomeName.toLowerCase().includes('neon'));
      
      if (isFuturistic) {
        // FUTURISTIC/CYBERPUNK - Dark cyberpunk aesthetic
        if (isNight || timeOfDay === 'night') {
          // Night: Very dark with neon cyan accents
          horizonColor = new THREE.Color(0x1a1a3a); // Dark blue-grey horizon
          middleColor = new THREE.Color(0x0a0a1a); // Almost black middle
          topColor = new THREE.Color(0x000011); // Pure black top
        } else if (timeOfDay === 'sunset') {
          // Sunset: Dark purple with magenta neon
          horizonColor = new THREE.Color(0x2d1b3d); // Dark purple horizon
          middleColor = new THREE.Color(0x1a0a2e); // Darker purple middle
          topColor = new THREE.Color(0x0a0515); // Very dark purple top
        } else {
          // Day: Dark blue-grey with cyan highlights
          horizonColor = new THREE.Color(0x1a1a2e); // Dark blue-grey horizon
          middleColor = new THREE.Color(0x0f1419); // Darker middle
          topColor = new THREE.Color(0x050a0f); // Almost black top
        }
      } else if (isCityNoon) {
        // CITY NOON - #D7AFF5 transitioning to pastel pale butter cream yellow
        topColor = new THREE.Color(0xD7AFF5); // Purple-pink at top
        middleColor = new THREE.Color(0xD7AFF5).lerp(new THREE.Color(0xFFF8DC), 0.5); // Blend between purple and butter cream
        horizonColor = new THREE.Color(0xFFF8DC); // Pastel pale butter cream yellow at horizon
        
      } else if (isNight) {
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
        setChatConversation([]); // Start fresh chat
        sendChatMessageForModify(transcript);
      } else {
        generateWorld(transcript);
      }
    };

    recognition.start();
  };
 
  // Update ref whenever physicsSettings changes
  useEffect(() => {
    physicsSettingsRef.current = physicsSettings;
  }, [physicsSettings]);

  const handlePhysicsChange = useCallback((newSettings) => {
    setPhysicsSettings(newSettings);
  }, []);

  const sendChatMessageForModify = async (userMessage) => {
    // Add user message to conversation
    const newMessages = [...chatConversation, { role: 'user', content: userMessage }];
    setChatConversation(newMessages);
    setIsWaitingForAI(true);
    // Don't change gameState - keep it as PLAYING so world stays visible

    try {
      // Get player position and direction for context
      const playerPos = playerRef.current ? {
        x: playerRef.current.position.x,
        y: playerRef.current.position.y,
        z: playerRef.current.position.z
      } : null;
      
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

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab4e53c8-3e02-4665-bb8e-bc913babc9ea',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:5322',message:'Chat modification request',data:{method:'POST',body:{messages: newMessages, current_world: currentWorld}},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1,H2'})}).catch(()=>{});
      // #endregion
      const res = await fetch(`${API_BASE}/modify-world`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          messages: newMessages,
          current_world: currentWorld,
          player_position: playerPos,
          player_direction: playerDirection
        }),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const data = await res.json();
      
      // Add AI response to conversation
      const updatedMessages = [...newMessages, { role: 'assistant', content: data.message }];
      setChatConversation(updatedMessages);

      setIsWaitingForAI(false);
    } catch (error) {
      console.error('Chat error:', error);
      setIsWaitingForAI(false);
      setChatConversation(prev => [...prev, { 
        role: 'assistant', 
        content: 'Sorry, I encountered an error. Please try again.' 
      }]);
    }
  };

  const confirmModification = async () => {
    // Get the last user message from conversation (most recent intent)
    const userMessages = chatConversation.filter(m => m.role === 'user');
    const commandText = userMessages.length > 0 
      ? userMessages[userMessages.length - 1].content 
      : modifyPrompt;
    
    // Save the entire conversation session to chat history
    if (chatConversation.length > 0) {
      setChatHistory(prev => [...prev, {
        session: [...chatConversation], // Store full conversation
        timestamp: new Date().toLocaleTimeString(),
        type: 'conversation'
      }]);
    }
    
    setChatConversation([]);
    setIsWaitingForAI(false);
    setGameState(GameState.GENERATING);
    await modifyWorld(commandText);
  };

  const handleTextSubmit = () => {
    if (!prompt.trim()) return;
    setSubmittedPrompt(prompt);
    generateWorld(prompt);
    setPrompt('');
  };

  const handleModifySubmit = () => {
    if (!modifyPrompt.trim()) return;
    const commandText = modifyPrompt.trim();
    setModifyPrompt('');
    setChatConversation([]); // Start fresh chat
    sendChatMessageForModify(commandText);
  };

  // Export function for glTF/GLB
  const exportWorldAsGLTF = (format = 'glb') => {
    if (!sceneRef.current) {
      alert('No world to export!');
      return;
    }

    const exporter = new GLTFExporter();
    
    // Collect all exportable objects (exclude sky, lights, camera, player, enemies)
    const exportableObjects = [];
    
    // Add terrain
    if (terrainMeshRef.current) {
      exportableObjects.push(terrainMeshRef.current);
    }
    
    // Add all structures (trees, rocks, peaks, buildings, street lamps, creative objects)
    structuresRef.current.forEach(struct => {
      if (struct && struct.parent === sceneRef.current) {
        exportableObjects.push(struct);
      }
    });
    
    if (exportableObjects.length === 0) {
      alert('No objects to export!');
      return;
    }
    
    // Create a temporary scene with only exportable objects
    const exportScene = new THREE.Scene();
    exportableObjects.forEach(obj => {
      const cloned = obj.clone(true); // Deep clone to preserve geometry/materials
      exportScene.add(cloned);
    });
    
    // Export options
    const options = {
      binary: format === 'glb', // true for GLB, false for glTF
      trs: false, // Use matrix instead of position/rotation/scale
      onlyVisible: true,
      includeCustomExtensions: false
    };
    
    exporter.parse(
      exportScene,
      (result) => {
        // Download the file
        const output = format === 'glb' ? result : JSON.stringify(result, null, 2);
        const blob = format === 'glb' 
          ? new Blob([result], { type: 'application/octet-stream' })
          : new Blob([output], { type: 'application/json' });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `world_export.${format}`;
        link.click();
        URL.revokeObjectURL(link.href);
        
        console.log(`✅ World exported as ${format.toUpperCase()}`);
      },
      (error) => {
        console.error('Export error:', error);
        alert('Failed to export world: ' + error.message);
      }
    );
  };

  // Export metadata JSON for procedural regeneration
  const exportWorldMetadata = () => {
    if (!currentWorld || !heightmapRef.current || !colorMapRef.current) {
      alert('No world data to export!');
      return;
    }

    const metadata = {
      version: '1.0.0',
      exportDate: new Date().toISOString(),
      world: {
        heightmap_raw: heightmapRef.current,
        colour_map_array: colorMapRef.current,
        terrain_size: 256,
        biome: currentWorld?.world?.biome || currentWorld?.world?.biome_name || 'unknown'
      },
      structures: {
        trees: [],
        rocks: [],
        peaks: [],
        buildings: [],
        street_lamps: [],
        creative_objects: []
      },
      player: playerRef.current ? {
        position: {
          x: playerRef.current.position.x,
          y: playerRef.current.position.y,
          z: playerRef.current.position.z
        }
      } : null
    };

    // Extract structure data from scene objects
    structuresRef.current.forEach(struct => {
      if (!struct.userData) return;
      
      const structType = struct.userData.structureType;
      const position = struct.position;
      const scale = struct.scale.x; // Assuming uniform scale
      
      const structData = {
        position: {
          x: position.x,
          y: position.y,
          z: position.z
        },
        scale: scale || 1.0
      };

      switch (structType) {
        case 'tree':
          structData.leafless = struct.userData.leafless || false;
          metadata.structures.trees.push(structData);
          break;
        case 'rock':
          metadata.structures.rocks.push(structData);
          break;
        case 'peak':
          metadata.structures.peaks.push(structData);
          break;
        case 'building':
          // Try to extract building type and dimensions if available
          if (struct.userData.buildingType) {
            structData.type = struct.userData.buildingType;
          }
          if (struct.userData.buildingWidth) {
            structData.width = struct.userData.buildingWidth;
            structData.depth = struct.userData.buildingDepth;
            structData.height = struct.userData.buildingHeight;
          }
          metadata.structures.buildings.push(structData);
          break;
        case 'street_lamp':
          metadata.structures.street_lamps.push(structData);
          break;
        case 'creative_object':
          // Use the originalData stored in userData for full reconstruction
          if (struct.userData.originalData) {
            // Include the full original data including parts array
            metadata.structures.creative_objects.push({
              ...struct.userData.originalData,
              position: {
                x: position.x,
                y: position.y,
                z: position.z
              }
            });
          } else {
            // Fallback if originalData is missing
            metadata.structures.creative_objects.push(structData);
          }
          break;
      }
    });

    // Download metadata JSON
    const blob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'world_metadata.json';
    link.click();
    URL.revokeObjectURL(link.href);
    
    console.log('✅ World metadata exported');
  };

  // Combined export function
  const exportWorld = async (format = 'all') => {
    if (!sceneRef.current) {
      alert('No world to export!');
      return;
    }

    if (format === 'all' || format === 'glb') {
      exportWorldAsGLTF('glb');
    }
    
    if (format === 'all' || format === 'gltf') {
      // Delay to avoid download conflicts
      setTimeout(() => exportWorldAsGLTF('gltf'), 500);
    }
    
    if (format === 'all' || format === 'metadata') {
      setTimeout(() => exportWorldMetadata(), 1000);
    }
  };

  return (
    <div style={{ 
      width: '100%', 
      height: '100vh', 
      position: 'relative', 
      background: '#000',
      cursor: editingMode ? 'crosshair' : 'default'
    }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute' }} />

      <div
        style={{
          position: 'absolute',
          top: '20px',
          left: '20px',
          zIndex: 20,
          padding: '6px 12px',
          borderRadius: '999px',
          backgroundColor: streamingActive
            ? 'rgba(34, 197, 94, 0.9)'
            : scanMode
            ? 'rgba(59, 130, 246, 0.9)'
            : 'rgba(75, 85, 99, 0.9)',
          color: '#fff',
          fontFamily: 'monospace',
          fontSize: '12px',
          pointerEvents: 'none',
          boxShadow: '0 4px 6px rgba(0,0,0,0.35)',
        }}
      >
        {streamingActive
          ? 'Camera: Overshoot streaming'
          : scanMode
          ? 'Camera: basic mode'
          : 'Camera: off'}
      </div>

      {/* Edit Mode Indicator */}
      {editingMode && (
        <div
          style={{
            position: 'absolute',
            top: '12px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            padding: '8px 16px',
            borderRadius: '999px',
            backgroundColor: 'rgba(255, 152, 0, 0.9)',
            color: '#fff',
            fontFamily: 'monospace',
            fontSize: '13px',
            pointerEvents: 'none',
            boxShadow: '0 4px 6px rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <span>✏️ EDIT MODE</span>
          <span style={{ fontSize: '11px', opacity: 0.9 }}>
            Click structures to move • Scroll to adjust height
          </span>
        </div>
      )}

      {/* Floating Camera Preview while Streaming */}
      {streamingActive && (
        <div
          style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: 150,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          {/* Camera Preview Rectangle */}
          <div
            style={{
              width: '280px',
              height: '210px',
              borderRadius: '12px',
              overflow: 'hidden',
              border: '3px solid #22c55e',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
              backgroundColor: '#000',
              position: 'relative',
            }}
          >
            {/* Live indicator */}
            <div
              style={{
                position: 'absolute',
                top: '10px',
                left: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                backgroundColor: 'rgba(220, 38, 38, 0.9)',
                padding: '4px 10px',
                borderRadius: '4px',
                zIndex: 10,
              }}
            >
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: '#fff',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}
              />
              <span style={{ color: '#fff', fontSize: '11px', fontWeight: 'bold', fontFamily: 'monospace' }}>
                LIVE
              </span>
            </div>
            
            {/* Analysis status indicator */}
            <div
              style={{
                position: 'absolute',
                bottom: '10px',
                left: '10px',
                right: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                backgroundColor: lastScanResult ? 'rgba(34, 197, 94, 0.9)' : 'rgba(59, 130, 246, 0.9)',
                padding: '6px 12px',
                borderRadius: '4px',
                zIndex: 10,
              }}
            >
              {lastScanResult ? (
                <>
                  <span style={{ fontSize: '14px' }}>✅</span>
                  <span style={{ color: '#fff', fontSize: '11px', fontWeight: 'bold', fontFamily: 'monospace' }}>
                    #{lastScanResult.frameCount || 1}: {lastScanResult.biome || lastScanResult.raw_text?.substring(0, 20) || 'Received'}
                  </span>
                </>
              ) : (
                <>
                  <div
                    style={{
                      width: '12px',
                      height: '12px',
                      border: '2px solid #fff',
                      borderTopColor: 'transparent',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                    }}
                  />
                  <span style={{ color: '#fff', fontSize: '11px', fontWeight: 'bold', fontFamily: 'monospace' }}>
                    Waiting for analysis...
                  </span>
                </>
              )}
            </div>
            
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: 'scaleX(-1)', // Mirror for better UX
              }}
            />
          </div>
          
          {/* Stop Streaming Button */}
          <button
            onClick={stopCameraCapture}
            style={{
              padding: '10px 20px',
              fontSize: '14px',
              backgroundColor: '#dc2626',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 4px 12px rgba(220, 38, 38, 0.4)',
              transition: 'background-color 0.2s, transform 0.1s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#b91c1c';
              e.currentTarget.style.transform = 'scale(1.02)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#dc2626';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            🛑 Stop Streaming
          </button>
        </div>
      )}

      {/* CSS for animations */}
      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>

     {gameState === GameState.PLAYING && (
  <GameSettingsPanel 
    onSettingsChange={handlePhysicsChange}
    initialSettings={physicsSettings}
  />
)}

     {gameState === GameState.PLAYING && (
  <ColorPicker
    onColorPaletteChange={handleColorPaletteChange}
    initialPalette={colorPalette}
    disabled={!currentWorld}
  />
)}

     {colorSchemeNotification && (
  <div style={{
    position: 'fixed',
    top: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: '#4CAF50',
    color: 'white',
    padding: '12px 24px',
    borderRadius: '6px',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    zIndex: 1000,
    fontSize: '16px',
    fontWeight: 'bold'
  }}>
    {colorSchemeNotification}
  </div>
)}

      {/* Pixel Art Button at Top Center - Appears after world generation */}
      {gameState === GameState.PLAYING && (
        <button
          onClick={() => {
            placeLebronImageOnTerrain();
          }}
          style={{
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '12px 24px',
            background: 'linear-gradient(to bottom, #FFB347, #FF8C42)',
            color: '#fff',
            border: '4px solid #8B4513',
            boxShadow: 'inset 0 0 0 2px #FFD700, inset 0 0 0 4px #8B4513, 0 2px 4px rgba(0,0,0,0.3)',
            borderRadius: '12px',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            fontFamily: '"Courier New", monospace',
            textTransform: 'uppercase',
            letterSpacing: '1px',
            imageRendering: 'pixelated',
            transition: 'opacity 0.2s',
            zIndex: 100,
            lineHeight: '1.2'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '0.9';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '1';
          }}
        >
          <span style={{ fontSize: '12px', fontWeight: 'bold' }}>CLICK HERE TO SEE</span>
          <span style={{ fontSize: '18px', fontWeight: 'bold' }}>LEBRON JAMES THE GOAT</span>
        </button>
      )}

      {gameState === GameState.PLAYING && (
        <>
          {/* Top-right circular controls: Nintendo Switch-style button cluster */}
          {/* Central Microphone Button (larger, red) - CENTER */}
          <div style={{
            position: 'fixed',
            top: '145px',
            right: '95px',
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
          <button
              onClick={() => startVoiceCapture(true)}
            style={{
                width: '70px',
                height: '70px',
              borderRadius: '50%',
                fontSize: '28px',
                background: isListening ? '#FF5555' : 'rgba(255, 85, 85, 0.9)',
              color: '#fff',
                border: '3px solid rgba(255, 120, 120, 0.9)',
                cursor: isListening ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(255,0,0,0.4)',
                transition: 'all 0.2s',
                animation: isListening ? 'pulse 1s infinite' : 'none',
                zIndex: 21
              }}
              onMouseEnter={e => !isListening && (e.currentTarget.style.opacity = '1')}
              onMouseLeave={e => e.currentTarget.style.opacity = '0.9'}
            >
              🎤
          </button>
          </div>

          {/* Top Row (1 button): Settings button is in GameSettingsPanel component (gear icon) */}
          
          {/* Bottom Row Right: Edit Mode (pencil) button - bottom right of pyramid */}
          <button
            onClick={() => {
              setEditingMode(!editingMode);
              // Clear selection when exiting edit mode
              if (editingMode && selectedStructureRef.current) {
                selectedStructureRef.current.traverse((child) => {
                  if (child.isMesh && child.material && child.material.emissive) {
                    child.material.emissive.setHex(0x000000);
                  }
                });
                setSelectedStructure(null);
                selectedStructureRef.current = null;
              }
            }}
            style={{
              position: 'fixed',
              top: '225px',
              right: '130px',
              zIndex: 20,
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              backgroundColor: editingMode ? 'rgba(255, 152, 0, 0.9)' : 'rgba(156, 39, 176, 0.9)',
              color: '#fff',
              border: editingMode ? '2px solid rgba(255, 183, 77, 0.9)' : '2px solid rgba(186, 104, 200, 0.9)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'monospace',
              fontSize: '22px',
              fontWeight: 'bold',
              transition: 'all 0.3s ease',
              boxShadow: '0 4px 6px rgba(0,0,0,0.3)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = editingMode ? 'rgba(255, 167, 38, 0.95)' : 'rgba(171, 71, 188, 0.95)';
              e.currentTarget.style.transform = 'scale(1.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = editingMode ? 'rgba(255, 152, 0, 0.9)' : 'rgba(156, 39, 176, 0.9)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
            title={editingMode ? 'Exit Edit Mode' : 'Enter Edit Mode - Move & adjust structures'}
          >
            ✏️
          </button>

          {/* Export Button - below the black info box with enemies/controls */}
          <div style={{
            position: 'fixed',
            top: '185px',
            left: '20px',
            zIndex: 20
          }}>
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: 'rgba(76, 175, 80, 0.9)',
                color: '#fff',
                border: '2px solid rgba(129, 199, 132, 0.9)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'monospace',
                fontSize: '22px',
                fontWeight: 'bold',
                transition: 'all 0.3s ease',
                boxShadow: '0 4px 6px rgba(0,0,0,0.3)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(96, 185, 100, 0.95)';
                e.currentTarget.style.transform = 'scale(1.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(76, 175, 80, 0.9)';
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              📥
            </button>
            
            {showExportMenu && (
              <div style={{
                position: 'absolute',
                top: '70px',
                right: '0',
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                border: '2px solid rgba(76, 175, 80, 0.9)',
                borderRadius: '8px',
                padding: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                minWidth: '200px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                zIndex: 11
              }}>
                <button 
                  onClick={() => { exportWorld('glb'); setShowExportMenu(false); }}
                  style={{
                    padding: '10px 15px',
                    backgroundColor: '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    transition: 'background-color 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#45a049'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#4CAF50'}
                >
                  Export as GLB
                </button>
                <button 
                  onClick={() => { exportWorld('gltf'); setShowExportMenu(false); }}
                  style={{
                    padding: '10px 15px',
                    backgroundColor: '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    transition: 'background-color 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#45a049'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#4CAF50'}
                >
                  Export as glTF
                </button>
                <button 
                  onClick={() => { exportWorld('metadata'); setShowExportMenu(false); }}
                  style={{
                    padding: '10px 15px',
                    backgroundColor: '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    transition: 'background-color 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#45a049'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#4CAF50'}
                >
                  Export Metadata JSON
                </button>
                <button 
                  onClick={() => { exportWorld('all'); setShowExportMenu(false); }}
                  style={{
                    padding: '10px 15px',
                    backgroundColor: '#2196F3',
                    color: 'white',
                    border: 'none',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    transition: 'background-color 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1976D2'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#2196F3'}
                >
                  Export All
                </button>
              </div>
            )}
          </div>

          {/* Middle Row (3 buttons): Home (left), Microphone (center), Chat History (right) */}
          {/* Chat History - right side of middle row */}
          <button
            onClick={() => setShowChatHistory(!showChatHistory)}
            style={{
              position: 'fixed',
              top: '145px',
              right: '25px',
              zIndex: 20,
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              backgroundColor: 'rgba(100, 100, 200, 0.9)',
              color: '#fff',
              border: '2px solid rgba(150, 150, 255, 0.9)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'monospace',
              fontSize: '22px',
              fontWeight: 'bold',
              transition: 'all 0.3s ease',
              boxShadow: '0 4px 6px rgba(0,0,0,0.3)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(120, 120, 220, 0.95)';
              e.currentTarget.style.transform = 'scale(1.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(100, 100, 200, 0.9)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            C
          </button>

          {/* Left Button: Home - to the left of microphone */}
          {/* (Home button is defined later in the file, positioning updated above) */}

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
              zIndex: 300,
              display: 'flex',
              flexDirection: 'column',
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
                  ×
                </button>
              </div>
              <div style={{ 
                padding: '20px', 
                flex: 1, 
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '20px'
              }}>
                {/* Show current active conversation if exists */}
                {chatConversation.length > 0 && (
                  <div style={{
                    padding: '12px',
                    backgroundColor: 'rgba(100, 150, 255, 0.3)',
                    borderRadius: '8px',
                    borderLeft: '3px solid rgba(150, 200, 255, 0.8)',
                    marginBottom: '10px'
                  }}>
                    <div style={{
                      color: '#88aaff',
                      fontSize: '11px',
                      marginBottom: '10px',
                      fontFamily: 'monospace',
                      borderBottom: '1px solid rgba(150, 200, 255, 0.3)',
                      paddingBottom: '5px',
                      fontWeight: 'bold'
                    }}>
                      Current Conversation
                    </div>
                    {chatConversation.map((msg, msgIndex) => (
                      <div
                        key={msgIndex}
                        style={{
                          marginBottom: '8px',
                          padding: '6px 8px',
                          backgroundColor: msg.role === 'user' 
                            ? 'rgba(100, 150, 255, 0.15)' 
                            : msg.role === 'system'
                            ? (msg.content.includes('✅') 
                                ? 'rgba(100, 200, 100, 0.15)' 
                                : msg.content.includes('❌')
                                ? 'rgba(200, 100, 100, 0.15)'
                                : 'rgba(200, 200, 200, 0.1)')
                            : 'rgba(200, 200, 200, 0.1)',
                          borderRadius: '4px',
                          marginLeft: msg.role === 'assistant' || msg.role === 'system' ? '0' : '20px',
                          marginRight: msg.role === 'user' ? '0' : '20px'
                        }}
                      >
                        <div style={{
                          color: '#fff',
                          fontSize: '13px',
                          fontFamily: 'monospace',
                          wordWrap: 'break-word'
                        }}>
                          <strong style={{ 
                            color: msg.role === 'user' 
                              ? '#88aaff' 
                              : msg.role === 'system'
                              ? (msg.content.includes('✅') ? '#88ff88' : msg.content.includes('❌') ? '#ff8888' : '#88ffaa')
                              : '#88ffaa',
                            marginRight: '8px'
                          }}>
                            {msg.role === 'user' ? 'You:' : msg.role === 'system' ? 'System:' : 'AI:'}
                          </strong>
                          {msg.content}
                        </div>
                      </div>
                    ))}
                    {isWaitingForAI && (
                      <div style={{ textAlign: 'left', marginTop: '8px', padding: '6px 8px' }}>
                        <div style={{
                          display: 'inline-block',
                          padding: '6px 8px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(200, 200, 200, 0.1)',
                          color: '#666',
                          fontSize: '13px'
                        }}>
                          AI is thinking...
                        </div>
                      </div>
                    )}
                  </div>
                )}
                
                {chatHistory.length === 0 && chatConversation.length === 0 ? (
                  <div style={{ color: '#888', textAlign: 'center', marginTop: '40px' }}>
                    No chat history yet
                  </div>
                ) : (
                  chatHistory.map((item, index) => {
                    // Handle full conversation sessions
                    if (item.type === 'conversation' && item.session) {
                      return (
                        <div
                          key={index}
                          style={{
                            marginBottom: '20px',
                            padding: '12px',
                            backgroundColor: 'rgba(100, 100, 200, 0.2)',
                            borderRadius: '8px',
                            borderLeft: '3px solid rgba(150, 150, 255, 0.8)'
                          }}
                        >
                          <div style={{
                            color: '#aaa',
                            fontSize: '11px',
                            marginBottom: '10px',
                            fontFamily: 'monospace',
                            borderBottom: '1px solid rgba(150, 150, 255, 0.3)',
                            paddingBottom: '5px'
                          }}>
                            Conversation - {item.timestamp}
                          </div>
                          {item.session.map((msg, msgIndex) => (
                            <div
                              key={msgIndex}
                              style={{
                                marginBottom: '8px',
                                padding: '6px 8px',
                                backgroundColor: msg.role === 'user' 
                                  ? 'rgba(100, 150, 255, 0.15)' 
                                  : msg.role === 'system'
                                  ? (msg.content.includes('✅') 
                                      ? 'rgba(100, 200, 100, 0.15)' 
                                      : msg.content.includes('❌')
                                      ? 'rgba(200, 100, 100, 0.15)'
                                      : 'rgba(200, 200, 200, 0.1)')
                                  : 'rgba(200, 200, 200, 0.1)',
                                borderRadius: '4px',
                                marginLeft: msg.role === 'assistant' || msg.role === 'system' ? '0' : '20px',
                                marginRight: msg.role === 'user' ? '0' : '20px'
                              }}
                            >
                              <div style={{
                                color: '#fff',
                                fontSize: '13px',
                                fontFamily: 'monospace',
                                wordWrap: 'break-word'
                              }}>
                                <strong style={{ 
                                  color: msg.role === 'user' 
                                    ? '#88aaff' 
                                    : msg.role === 'system'
                                    ? (msg.content.includes('✅') ? '#88ff88' : msg.content.includes('❌') ? '#ff8888' : '#88ffaa')
                                    : '#88ffaa',
                                  marginRight: '8px'
                                }}>
                                  {msg.role === 'user' ? 'You:' : msg.role === 'system' ? 'System:' : 'AI:'}
                                </strong>
                                {msg.content}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    }
                    
                    // Handle legacy single command format (backward compatibility)
                    return (
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
                    );
                  })
                )}
              </div>
              
              {/* Chat Input Area */}
              <div style={{
                padding: '15px',
                borderTop: '1px solid rgba(150, 150, 255, 0.3)',
                backgroundColor: 'rgba(20, 20, 30, 0.95)',
                display: 'flex',
                gap: '8px',
                alignItems: 'center'
              }}>
                <input
                  type="text"
                  value={historyChatInput}
                  onChange={e => setHistoryChatInput(e.target.value)}
                  onKeyPress={e => {
                    if (e.key === 'Enter' && !isWaitingForAI && historyChatInput.trim()) {
                      const message = historyChatInput.trim();
                      setHistoryChatInput('');
                      sendChatMessageForModify(message);
                    }
                  }}
                  placeholder={isWaitingForAI ? "AI is responding..." : "Type your message..."}
                  disabled={isWaitingForAI || gameState !== GameState.PLAYING}
                  style={{
                    flex: 1,
                    border: '1px solid rgba(150, 150, 255, 0.3)',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    fontSize: '14px',
                    fontFamily: 'monospace',
                    backgroundColor: 'rgba(30, 30, 40, 0.8)',
                    color: '#fff',
                    outline: 'none'
                  }}
                />
                <button
                  onClick={() => {
                    if (!isWaitingForAI && historyChatInput.trim() && gameState === GameState.PLAYING) {
                      const message = historyChatInput.trim();
                      setHistoryChatInput('');
                      sendChatMessageForModify(message);
                    }
                  }}
                  disabled={isWaitingForAI || !historyChatInput.trim() || gameState !== GameState.PLAYING}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: (isWaitingForAI || !historyChatInput.trim() || gameState !== GameState.PLAYING)
                      ? 'rgba(100, 100, 100, 0.5)'
                      : 'rgba(100, 150, 255, 0.8)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: (isWaitingForAI || !historyChatInput.trim() || gameState !== GameState.PLAYING)
                      ? 'not-allowed'
                      : 'pointer',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    fontFamily: 'monospace',
                    transition: 'background-color 0.2s'
                  }}
                >
                  Send
                </button>
                {chatConversation.length > 0 && 
                 chatConversation[chatConversation.length - 1].role === 'assistant' &&
                 !isWaitingForAI && (
                  <button
                    onClick={confirmModification}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#4CAF50',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      fontFamily: 'monospace'
                    }}
                  >
                    Apply
                  </button>
                )}
              </div>
            </div>
          )}

          <div style={{
            position: 'absolute', top: 68, left: 20, zIndex: 10,
            backgroundColor: 'rgba(0,0,0,0.7)',
            padding: '14px', borderRadius: '8px',
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
              

            `}</style>
          </div>

          {/* Home Button (right of the C button) */}
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
              position: 'fixed',
              top: '145px',
              right: '175px',
              zIndex: 20,
              width: '56px',
              height: '56px',
                borderRadius: '50%',
              backgroundColor: 'rgba(100, 100, 200, 0.9)',
                color: '#fff',
              border: '2px solid rgba(150, 150, 255, 0.9)',
              cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              fontFamily: 'monospace',
              fontSize: '22px',
              fontWeight: 'bold',
              transition: 'all 0.3s ease',
              boxShadow: '0 4px 6px rgba(0,0,0,0.3)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(120, 120, 220, 0.95)';
              e.currentTarget.style.transform = 'scale(1.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(100, 100, 200, 0.9)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            🏠
            </button>

            <style>{`
              @keyframes pulse {
                0% { transform: scale(1); box-shadow: 0 0 12px rgba(255,0,0,0.4); }
                50% { transform: scale(1.1); box-shadow: 0 0 24px rgba(255,0,0,0.6); }
                100% { transform: scale(1); box-shadow: 0 0 12px rgba(255,0,0,0.4); }
              }
            `}</style>
        </>
      )}

      {gameState === GameState.IDLE && (
        <div style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 100,
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
          flexDirection: 'column', fontFamily: 'sans-serif',
          textAlign: 'center', padding: '20px', paddingBottom: '120px', overflow: 'hidden'
        }}>
          <video
            autoPlay
            muted
            playsInline
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              zIndex: -1
            }}
          >
            <source src="/hot_yolk.mp4" type="video/mp4" />
          </video>
          <div style={{
            position: 'relative', zIndex: 1,
            width: '100%', maxWidth: '350px',
            backgroundColor: '#fff',
            borderRadius: '12px',
            border: '2px solid #1e3a8a',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
          }}>
            {/* Search Bar */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              padding: '8px 16px',
              gap: '12px'
            }}>
              <input
                type="text"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && handleTextSubmit()}
                placeholder="look for"
                style={{
                  flex: 1,
                  border: 'none',
                  outline: 'none',
                  fontSize: '16px',
                  color: '#666',
                  fontFamily: 'sans-serif',
                  background: 'transparent'
                }}
              />
              <button
                onClick={startVoiceCapture}
                disabled={isListening}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: isListening ? 'not-allowed' : 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: isListening ? '#999' : '#4A90E2'
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                </svg>
              </button>
            </div>

            {/* Separator */}
            <div style={{
              height: '1px',
              backgroundColor: '#4A90E2',
              margin: '0 16px'
            }} />

            {/* Suggestions */}
            <div style={{ padding: '4px 0' }}>
              {["look for a friend? eh.", 'look for a new home? sure!'].map((suggestion, index) => (
                <div
                  key={index}
                  onClick={() => {
                    setPrompt(suggestion);
                    setSubmittedPrompt(suggestion);
                    generateWorld(suggestion);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '6px 16px',
                    cursor: 'pointer',
                    gap: '12px',
                    transition: 'background-color 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <svg width="15" height="18" viewBox="0 0 24 24" fill="#999">
                    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                  </svg>
                  <span style={{
                    color: '#999',
                    fontSize: '16px',
                    fontFamily: 'sans-serif'
                  }}>
                    {suggestion}
                  </span>
                </div>
              ))}
            </div>

            {/* Scan Mode Button */}
            <div style={{ padding: '12px 16px', borderTop: '1px solid #e0e0e0' }}>
              <button
                onClick={scanMode ? stopCameraCapture : startCameraCapture}
                style={{
                  width: '100%',
                  padding: '8px 16px',
                  fontSize: '14px',
                  background: scanMode 
                    ? 'linear-gradient(to bottom, #FF6B35, #C44536)' 
                    : 'linear-gradient(to bottom, #FFB347, #FF8C42)',
                  color: '#fff',
                  border: '4px solid #8B4513',
                  boxShadow: 'inset 0 0 0 2px #FFD700, inset 0 0 0 4px #8B4513, 0 2px 4px rgba(0,0,0,0.3)',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  fontFamily: '"Courier New", monospace',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  imageRendering: 'pixelated',
                  transition: 'opacity 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '0.9';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '1';
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ imageRendering: 'pixelated' }}>
                  <path d="M12 12.5c1.38 0 2.5-1.12 2.5-2.5S13.38 7.5 12 7.5 9.5 8.62 9.5 10s1.12 2.5 2.5 2.5zm0-7c2.49 0 4.5 2.01 4.5 4.5S14.49 14.5 12 14.5 7.5 12.49 7.5 10 9.51 5.5 12 5.5zM12 19c-7 0-11-4.03-11-9V6h2v4c0 4.97 3.51 7 9 7s9-2.03 9-7V6h2v4c0 4.97-4 9-11 9z"/>
                </svg>
                {scanMode ? (streamingActive ? '🛑 Stop Streaming' : 'Cancel Scan') : 'start video streaming'}
          </button>
            </div>
          </div>
        </div>
      )}

      {/* Camera View Overlay */}
      {scanMode && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: '#000',
          zIndex: 200,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            style={{
              width: '100%',
              maxWidth: '800px',
              maxHeight: '80vh',
              borderRadius: '12px',
              transform: 'scaleX(-1)' // Mirror the video for better UX
            }}
          />
          
          <div style={{
            marginTop: '30px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '15px'
          }}>
            <button
              onClick={captureAndScanWorld}
              style={{
                padding: '10px 30px',
                fontSize: '16px',
                background: streamingActive 
                  ? 'linear-gradient(to bottom, #FF6B35, #C44536)' 
                  : 'linear-gradient(to bottom, #FFB347, #FF8C42)',
                color: '#fff',
                border: '4px solid #8B4513',
                boxShadow: 'inset 0 0 0 2px #FFD700, inset 0 0 0 4px #8B4513, 0 2px 4px rgba(0,0,0,0.3)',
                borderRadius: '12px',
                cursor: 'pointer',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                fontFamily: '"Courier New", monospace',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                imageRendering: 'pixelated',
                transition: 'opacity 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
              onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ imageRendering: 'pixelated' }}>
                <path d="M12 12.5c1.38 0 2.5-1.12 2.5-2.5S13.38 7.5 12 7.5 9.5 8.62 9.5 10s1.12 2.5 2.5 2.5zm0-7c2.49 0 4.5 2.01 4.5 4.5S14.49 14.5 12 14.5 7.5 12.49 7.5 10 9.51 5.5 12 5.5zM12 19c-7 0-11-4.03-11-9V6h2v4c0 4.97 3.51 7 9 7s9-2.03 9-7V6h2v4c0 4.97-4 9-11 9z"/>
              </svg>
              {streamingActive ? 'streaming...' : 'start video streaming'}
            </button>
            
            <button
              onClick={stopCameraCapture}
              style={{
                padding: '12px 24px',
                fontSize: '14px',
                backgroundColor: 'transparent',
                color: '#fff',
                border: '2px solid #fff',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {(gameState === GameState.CHATTING || (gameState === GameState.PLAYING && chatConversation.length > 0)) && (
        <div style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 100,
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
          flexDirection: 'column', fontFamily: 'sans-serif',
          textAlign: 'center', padding: '20px', paddingBottom: '120px', overflow: 'hidden',
          pointerEvents: 'none' // Allow clicks to pass through to world
        }}>
          {/* Only show video background if NOT in PLAYING state (i.e., if in CHATTING state from homescreen) */}
          {gameState === GameState.CHATTING && (
            <video
              autoPlay
              muted
              playsInline
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                zIndex: -1
              }}
            >
              <source src="/hot_yolk.mp4" type="video/mp4" />
            </video>
          )}

          {/* Chat Container */}
          <div style={{
            position: 'relative', zIndex: 1,
            width: '100%', maxWidth: '500px',
            backgroundColor: '#fff',
            borderRadius: '12px',
            border: '2px solid #1e3a8a',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            maxHeight: '60vh',
            display: 'flex',
            flexDirection: 'column',
            pointerEvents: 'auto' // Re-enable pointer events for the chat container
          }}>
            {/* Chat Messages */}
            <div style={{
              padding: '16px',
              overflowY: 'auto',
              flex: 1,
              minHeight: '200px',
              maxHeight: '400px'
            }}>
              {chatConversation.map((msg, idx) => (
                <div
                  key={idx}
                  style={{
                    marginBottom: '12px',
                    textAlign: msg.role === 'user' ? 'right' : 'left'
                  }}
                >
                  <div style={{
                    display: 'inline-block',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    backgroundColor: msg.role === 'user' ? '#4A90E2' : '#f0f0f0',
                    color: msg.role === 'user' ? '#fff' : '#333',
                    maxWidth: '80%',
                    fontSize: '14px',
                    fontFamily: 'sans-serif'
                  }}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {isWaitingForAI && (
                <div style={{ textAlign: 'left', marginTop: '12px' }}>
                  <div style={{
                    display: 'inline-block',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    backgroundColor: '#f0f0f0',
                    color: '#666',
                    fontSize: '14px'
                  }}>
                    Thinking...
                  </div>
                </div>
              )}
            </div>

            {/* Input Area */}
            <div style={{
              borderTop: '1px solid #e0e0e0',
              padding: '12px 16px',
              display: 'flex',
              gap: '8px'
            }}>
              <input
                type="text"
                value={modifyPrompt}
                onChange={e => setModifyPrompt(e.target.value)}
                onKeyPress={e => {
                  if (e.key === 'Enter' && !isWaitingForAI) {
                    const userMessage = modifyPrompt.trim();
                    if (userMessage) {
                      setModifyPrompt('');
                      sendChatMessageForModify(userMessage);
                    }
                  }
                }}
                placeholder={isWaitingForAI ? "AI is responding..." : "Type your response..."}
                disabled={isWaitingForAI}
                style={{
                  flex: 1,
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  fontSize: '14px',
                  fontFamily: 'sans-serif',
                  outline: 'none'
                }}
              />
              {chatConversation.length > 0 && 
               chatConversation[chatConversation.length - 1].role === 'assistant' &&
               !isWaitingForAI && (
                <button
                  onClick={confirmModification}
                  disabled={isWaitingForAI}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#4CAF50',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: isWaitingForAI ? 'not-allowed' : 'pointer',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    fontFamily: 'sans-serif'
                  }}
                >
                  Apply
                </button>
              )}
          </div>
          </div>
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
            Cooking up <span style={{ color: '#4fa3ff' }}>YOUR</span> world...
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
