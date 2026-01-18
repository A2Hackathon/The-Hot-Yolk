import React, { useState, useEffect } from 'react';
import { Palette } from 'lucide-react';

// Convert hex to HSL
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
      default: break;
    }
  }
  return [h * 360, s * 100, l * 100];
}

// Convert HSL to hex
function hslToHex(h, s, l) {
  l /= 100;
  const a = s * Math.min(l, 1 - l) / 100;
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Generate color scheme
const generateColorScheme = (baseHex, schemeType) => {
  const [h, s, l] = hexToHsl(baseHex);
  
  switch (schemeType) {
    case 'complementary':
      return [baseHex, hslToHex((h + 180) % 360, s, l)];
      
    case 'analogous':
      return [
        hslToHex((h - 30 + 360) % 360, s, l),
        baseHex,
        hslToHex((h + 30) % 360, s, l),
        hslToHex((h + 60) % 360, s, l)
      ];
      
    case 'triadic':
      return [
        baseHex,
        hslToHex((h + 120) % 360, s, l),
        hslToHex((h + 240) % 360, s, l)
      ];
      
    case 'splitComplementary':
      return [
        baseHex,
        hslToHex((h + 150) % 360, s, l),
        hslToHex((h + 210) % 360, s, l)
      ];
      
    case 'monochromatic':
      // Vary lightness
      return [
        hslToHex(h, s, Math.max(0, l - 30)),
        hslToHex(h, s, l),
        hslToHex(h, s, Math.min(100, l + 30))
      ];
      
    default:
      return [baseHex];
  }
};

const ColorPicker = ({ onColorPaletteChange, initialPalette = null, disabled = false }) => {
  const [selectedColor, setSelectedColor] = useState('#4BBB6D');
  const [schemeType, setSchemeType] = useState('complementary');
  const [generatedPalette, setGeneratedPalette] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  
  // Initialize with initial palette if provided
  useEffect(() => {
    if (initialPalette && initialPalette.length > 0) {
      setSelectedColor(initialPalette[0]);
      setGeneratedPalette(initialPalette);
    }
  }, [initialPalette]);
  
  // Generate color scheme when color or scheme type changes
  useEffect(() => {
    if (!disabled) {
      const palette = generateColorScheme(selectedColor, schemeType);
      setGeneratedPalette(palette);
    }
  }, [selectedColor, schemeType, disabled]);

  const handleColorChange = (e) => {
    setSelectedColor(e.target.value);
  };

  const handleSchemeChange = (e) => {
    setSchemeType(e.target.value);
  };

  const handleApply = () => {
    if (generatedPalette.length > 0 && onColorPaletteChange) {
      onColorPaletteChange(generatedPalette);
      setIsOpen(false);
    }
  };

  if (disabled) {
    return null;
  }

  return (
    <div style={{
      position: 'fixed',
      top: '225px',
      right: '65px',
      zIndex: 200,
      pointerEvents: 'none',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end'
    }}>
      {/* Toggle Button - Bottom row left position in pyramid layout */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          backgroundColor: 'rgba(200, 100, 200, 0.9)',
          color: '#fff',
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          border: '2px solid rgba(220, 150, 255, 0.9)',
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
          e.currentTarget.style.backgroundColor = 'rgba(220, 120, 220, 0.95)';
          e.currentTarget.style.transform = 'scale(1.05)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(200, 100, 200, 0.9)';
          e.currentTarget.style.transform = 'scale(1)';
        }}
      >
        <Palette size={22} />
      </button>
      
      {/* Color Picker Panel */}
      <div
        style={{
          backgroundColor: '#111827',
          color: 'white',
          width: '360px',
          maxHeight: 'calc(100vh - 200px)',
          boxShadow: '-4px 0 10px rgba(0,0,0,0.5)',
          borderRadius: '8px',
          position: 'absolute',
          right: '70px',
          top: '0',
          transform: isOpen ? 'translateX(0)' : 'translateX(120%)',
          opacity: isOpen ? 1 : 0,
          transition: 'all 0.3s ease-in-out',
          pointerEvents: isOpen ? 'auto' : 'none',
          overflowY: 'auto'
        }}
      >
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            paddingBottom: '16px',
            borderBottom: '1px solid #374151'
          }}>
            <Palette size={28} style={{ color: '#a855f7' }} />
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>Color Palette</h2>
          </div>
          
          {/* Color Picker */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <label style={{ fontSize: '18px', fontWeight: '600', color: '#e5e7eb' }}>
              Base Color
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <input
                type="color"
                value={selectedColor}
                onChange={handleColorChange}
                style={{
                  width: '80px',
                  height: '80px',
                  borderRadius: '8px',
                  border: '2px solid #374151',
                  cursor: 'pointer',
                  backgroundColor: selectedColor
                }}
              />
              <div style={{ 
                flex: 1,
                padding: '12px',
                backgroundColor: '#1f2937',
                borderRadius: '8px',
                fontFamily: 'monospace',
                fontSize: '16px',
                color: selectedColor
              }}>
                {selectedColor.toUpperCase()}
              </div>
            </div>
          </div>
          
          {/* Scheme Type Selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <label style={{ fontSize: '18px', fontWeight: '600', color: '#e5e7eb' }}>
              Color Scheme
            </label>
            <select
              value={schemeType}
              onChange={handleSchemeChange}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: '#1f2937',
                color: '#e5e7eb',
                border: '2px solid #374151',
                borderRadius: '8px',
                fontSize: '16px',
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              <option value="complementary">Complementary (2 colors)</option>
              <option value="analogous">Analogous (4 colors)</option>
              <option value="triadic">Triadic (3 colors)</option>
              <option value="splitComplementary">Split Complementary (3 colors)</option>
              <option value="monochromatic">Monochromatic (3 shades)</option>
            </select>
          </div>
          
          {/* Generated Palette Preview */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <label style={{ fontSize: '18px', fontWeight: '600', color: '#e5e7eb' }}>
              Generated Palette ({generatedPalette.length} colors)
            </label>
            <div style={{ 
              display: 'flex', 
              flexWrap: 'wrap',
              gap: '8px',
              padding: '16px',
              backgroundColor: '#1f2937',
              borderRadius: '8px',
              minHeight: '80px'
            }}>
              {generatedPalette.map((color, i) => (
                <div
                  key={i}
                  style={{
                    width: '60px',
                    height: '60px',
                    backgroundColor: color,
                    borderRadius: '8px',
                    border: '2px solid #374151',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'transform 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.1)';
                    e.currentTarget.style.borderColor = '#fff';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.borderColor = '#374151';
                  }}
                  title={color.toUpperCase()}
                />
              ))}
            </div>
            <div style={{ 
              display: 'flex', 
              gap: '8px', 
              fontSize: '12px', 
              color: '#9ca3af',
              flexWrap: 'wrap'
            }}>
              {generatedPalette.map((color, i) => (
                <span key={i} style={{ fontFamily: 'monospace' }}>
                  {color.toUpperCase()}
                </span>
              ))}
            </div>
          </div>
          
          {/* Apply Button */}
          <button
            onClick={handleApply}
            style={{
              width: '100%',
              padding: '14px',
              backgroundColor: '#a855f7',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '18px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#9333ea';
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#a855f7';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
            }}
          >
            Apply to World
          </button>
          
        </div>
      </div>
    </div>
  );
};

export default ColorPicker;
