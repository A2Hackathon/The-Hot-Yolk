import React, { useState, useEffect } from 'react';
import { Settings, ChevronRight } from 'lucide-react';

const GameSettingsPanel = ({ onSettingsChange, initialSettings }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [speed, setSpeed] = useState(initialSettings?.speed || 5.0);
  const [gravity, setGravity] = useState(initialSettings?.gravity || 20.0);
  const [jumpHeight, setJumpHeight] = useState(initialSettings?.jumpHeight || 3.0);
  
  // Sync with initialSettings when it changes
  useEffect(() => {
    if (initialSettings) {
      setSpeed(initialSettings.speed || 5.0);
      setGravity(initialSettings.gravity || 20.0);
      setJumpHeight(initialSettings.jumpHeight || 3.0);
    }
  }, [initialSettings]);
  
  // Update parent whenever settings change
  useEffect(() => {
    if (onSettingsChange) {
      onSettingsChange({
        speed,
        gravity,
        jumpHeight
      });
    }
  }, [speed, gravity, jumpHeight, onSettingsChange]);
  
  const handleSpeedChange = (e) => {
    const newSpeed = parseFloat(e.target.value);
    setSpeed(newSpeed);
    console.log('[SETTINGS] Speed updated:', newSpeed);
  };
  
  const handleGravityChange = (e) => {
    const newGravity = parseFloat(e.target.value);
    setGravity(newGravity);
    console.log('[SETTINGS] Gravity updated:', newGravity);
  };
  
  const handleJumpChange = (e) => {
    const newJump = parseFloat(e.target.value);
    setJumpHeight(newJump);
    console.log('[SETTINGS] Jump height updated:', newJump);
  };
  
  const resetDefaults = () => {
    setSpeed(5.0);
    setGravity(20.0);
    setJumpHeight(3.0);
    console.log('[SETTINGS] Reset to defaults');
  };

  return (
    <div style={{
      position: 'fixed',
      top: '95px',
      right: '95px',
      zIndex: 200,
      pointerEvents: 'none',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end'
    }}>
      {/* Toggle Button - positioned in Nintendo Switch layout (top of cluster) */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          backgroundColor: 'rgba(100, 100, 200, 0.9)',
          color: '#fff',
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          border: '2px solid rgba(150, 150, 255, 0.9)',
          cursor: 'pointer',
          boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
          transition: 'all 0.3s ease',
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          top: '0',
          right: '0'
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
        <Settings size={22} />
      </button>
      
      {/* Settings Panel */}
      <div
        style={{
          backgroundColor: '#111827',
          color: 'white',
          width: '320px',
          maxHeight: 'calc(100vh - 100px)',
          boxShadow: '-4px 0 10px rgba(0,0,0,0.5)',
          borderRadius: '8px',
          transform: isOpen ? 'translateY(0)' : 'translateY(-120%)',
          opacity: isOpen ? 1 : 0,
          transition: 'all 0.3s ease-in-out',
          pointerEvents: isOpen ? 'auto' : 'none',
          overflowY: 'auto'
        }}
      >
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '32px',
            paddingBottom: '16px',
            borderBottom: '1px solid #374151'
          }}>
            <Settings size={28} style={{ color: '#3b82f6' }} />
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>Physics Settings</h2>
          </div>
          
          {/* Sliders Container */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '32px', overflowY: 'auto' }}>
            {/* Speed Slider */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '18px', fontWeight: '600', color: '#e5e7eb' }}>
                  Movement Speed
                </label>
                <span style={{
                  color: '#3b82f6',
                  fontFamily: 'monospace',
                  fontSize: '18px',
                  backgroundColor: '#1f2937',
                  padding: '4px 12px',
                  borderRadius: '4px'
                }}>
                  {speed.toFixed(1)}
                </span>
              </div>
              <input
                type="range"
                min="2.0"
                max="12.0"
                step="0.5"
                value={speed}
                onChange={handleSpeedChange}
                style={{
                  width: '100%',
                  height: '12px',
                  backgroundColor: '#374151',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  outline: 'none'
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#9ca3af' }}>
                <span>Slow (2.0)</span>
                <span>Fast (12.0)</span>
              </div>
            </div>
            
            {/* Gravity Slider */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '18px', fontWeight: '600', color: '#e5e7eb' }}>
                  Gravity
                </label>
                <span style={{
                  color: '#10b981',
                  fontFamily: 'monospace',
                  fontSize: '18px',
                  backgroundColor: '#1f2937',
                  padding: '4px 12px',
                  borderRadius: '4px'
                }}>
                  {gravity.toFixed(1)}
                </span>
              </div>
              <input
                type="range"
                min="10.0"
                max="40.0"
                step="1.0"
                value={gravity}
                onChange={handleGravityChange}
                style={{
                  width: '100%',
                  height: '12px',
                  backgroundColor: '#374151',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  outline: 'none'
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#9ca3af' }}>
                <span>Light (10.0)</span>
                <span>Heavy (40.0)</span>
              </div>
            </div>
            
            {/* Jump Height Slider */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '18px', fontWeight: '600', color: '#e5e7eb' }}>
                  Jump Height
                </label>
                <span style={{
                  color: '#a855f7',
                  fontFamily: 'monospace',
                  fontSize: '18px',
                  backgroundColor: '#1f2937',
                  padding: '4px 12px',
                  borderRadius: '4px'
                }}>
                  {jumpHeight.toFixed(1)}
                </span>
              </div>
              <input
                type="range"
                min="1.0"
                max="8.0"
                step="0.5"
                value={jumpHeight}
                onChange={handleJumpChange}
                style={{
                  width: '100%',
                  height: '12px',
                  backgroundColor: '#374151',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  outline: 'none'
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#9ca3af' }}>
                <span>Low (1.0)</span>
                <span>High (8.0)</span>
              </div>
            </div>
            
            {/* Visual Indicators */}
            <div style={{
              backgroundColor: '#1f2937',
              borderRadius: '8px',
              padding: '16px',
              marginTop: '24px'
            }}>
              <h3 style={{ fontSize: '14px', fontWeight: '600', color: '#d1d5db', marginBottom: '12px' }}>Current Settings</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#9ca3af' }}>Speed:</span>
                  <span style={{ color: '#3b82f6', fontWeight: '600' }}>{speed.toFixed(1)} units/s</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#9ca3af' }}>Gravity:</span>
                  <span style={{ color: '#10b981', fontWeight: '600' }}>-{gravity.toFixed(1)} m/s²</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#9ca3af' }}>Jump:</span>
                  <span style={{ color: '#a855f7', fontWeight: '600' }}>{jumpHeight.toFixed(1)} units</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* Reset Button */}
          <button
            onClick={resetDefaults}
            style={{
              marginTop: '24px',
              width: '100%',
              backgroundColor: '#dc2626',
              color: 'white',
              fontWeight: '600',
              padding: '12px 16px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = '#b91c1c';
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = '#dc2626';
            }}
          >
            Reset to Defaults
          </button>
          
          {/* Footer Info */}
          <div style={{
            marginTop: '16px',
            fontSize: '12px',
            color: '#6b7280',
            textAlign: 'center'
          }}>
            Changes apply immediately
          </div>
        </div>
      </div>
      
      <style>{`
        input[type="range"]::-webkit-slider-thumb {
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
        }
        
        input[type="range"]::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: none;
          box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
        }
      `}</style>
    </div>
  );
};

export default GameSettingsPanel;