/**
 * Vibrant multi-color sample images generated client-side onto canvases.
 * Tailored to demonstrate multi-color vectorization and white-to-transparent background removal.
 */

export interface SampleImage {
  id: string;
  name: string;
  category: string;
  description: string;
  hasWhiteBg: boolean;
  bgType?: 'magenta' | 'white';
  getDataUrl: () => string;
}

function createCyberMechaSticker(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 600;
  const ctx = canvas.getContext('2d')!;

  // Solid Magenta (#FF00FF) Background — Main Background Removal Test!
  ctx.fillStyle = '#FF00FF';
  ctx.fillRect(0, 0, 600, 600);

  ctx.save();
  ctx.translate(300, 300);

  // Outer Wings / Flame Crest — Bold Red (#FF0000)
  // Key test: Red (#FF0000) MUST NOT be removed by Magenta background remover!
  ctx.fillStyle = '#FF0000';
  ctx.beginPath();
  // Left Wing
  ctx.moveTo(-40, -160);
  ctx.lineTo(-210, -110);
  ctx.lineTo(-170, 20);
  ctx.lineTo(-80, 50);
  ctx.lineTo(-60, -100);
  ctx.closePath();
  ctx.fill();

  // Right Wing
  ctx.beginPath();
  ctx.moveTo(40, -160);
  ctx.lineTo(210, -110);
  ctx.lineTo(170, 20);
  ctx.lineTo(80, 50);
  ctx.lineTo(60, -100);
  ctx.closePath();
  ctx.fill();

  // Wing inner highlights - Golden Yellow (#FFD700)
  ctx.fillStyle = '#FFD700';
  ctx.beginPath();
  ctx.moveTo(-50, -120);
  ctx.lineTo(-160, -80);
  ctx.lineTo(-120, -10);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(50, -120);
  ctx.lineTo(160, -80);
  ctx.lineTo(120, -10);
  ctx.closePath();
  ctx.fill();

  // Helmet / Body Armor: Deep Charcoal Navy (#1E293B)
  ctx.fillStyle = '#1E293B';
  ctx.beginPath();
  ctx.moveTo(0, -170);
  ctx.lineTo(90, -70);
  ctx.lineTo(80, 110);
  ctx.lineTo(0, 180);
  ctx.lineTo(-80, 110);
  ctx.lineTo(-90, -70);
  ctx.closePath();
  ctx.fill();

  // Visor: Cyan / Neon Teal (#06B6D4)
  ctx.fillStyle = '#06B6D4';
  ctx.beginPath();
  ctx.moveTo(-60, -40);
  ctx.lineTo(60, -40);
  ctx.lineTo(45, 15);
  ctx.lineTo(-45, 15);
  ctx.closePath();
  ctx.fill();

  // Pure White Eyes & Reflection Highlights (#FFFFFF)
  // Key test: White details MUST remain solid in Magenta mode!
  ctx.fillStyle = '#FFFFFF';
  // Left Eye Glint
  ctx.beginPath();
  ctx.ellipse(-30, -15, 14, 7, -0.1, 0, Math.PI * 2);
  ctx.fill();
  // Right Eye Glint
  ctx.beginPath();
  ctx.ellipse(30, -15, 14, 7, 0.1, 0, Math.PI * 2);
  ctx.fill();

  // Pure White Center Emblem Star (#FFFFFF)
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  const starR = 18;
  for (let s = 0; s < 10; s++) {
    const angle = (s * Math.PI) / 5 - Math.PI / 2;
    const r = s % 2 === 0 ? starR : starR * 0.45;
    const sx = Math.cos(angle) * r;
    const sy = 80 + Math.sin(angle) * r;
    if (s === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.closePath();
  ctx.fill();

  // Emerald Green Forehead Jewel (#10B981)
  ctx.fillStyle = '#10B981';
  ctx.beginPath();
  ctx.moveTo(0, -135);
  ctx.lineTo(25, -95);
  ctx.lineTo(0, -75);
  ctx.lineTo(-25, -95);
  ctx.closePath();
  ctx.fill();

  // Pure White Jewel Sparkle (#FFFFFF)
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(0, -100, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  return canvas.toDataURL('image/png');
}

function createChameleonSticker(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 600;
  const ctx = canvas.getContext('2d')!;

  // Clean solid white background (ideal to test white-to-transparent!)
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, 600, 600);

  ctx.save();
  ctx.translate(300, 310);

  // Branch
  ctx.fillStyle = '#78350F';
  ctx.beginPath();
  ctx.moveTo(-250, 140);
  ctx.quadraticCurveTo(0, 110, 250, 130);
  ctx.lineTo(250, 170);
  ctx.quadraticCurveTo(0, 150, -250, 180);
  ctx.closePath();
  ctx.fill();

  // Branch buds
  ctx.fillStyle = '#10B981';
  ctx.beginPath();
  ctx.ellipse(-180, 130, 25, 12, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(190, 125, 25, 12, 0.4, 0, Math.PI * 2);
  ctx.fill();

  // Curly tail (multi-color spiral)
  ctx.strokeStyle = '#06B6D4';
  ctx.lineWidth = 32;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(-110, 40, 75, Math.PI * 0.4, Math.PI * 2.2);
  ctx.stroke();

  ctx.strokeStyle = '#3B82F6';
  ctx.lineWidth = 20;
  ctx.beginPath();
  ctx.arc(-110, 40, 50, Math.PI * 0.8, Math.PI * 2.5);
  ctx.stroke();

  // Chameleon Body
  ctx.fillStyle = '#10B981'; // Emerald Green
  ctx.beginPath();
  ctx.ellipse(0, 0, 150, 100, -0.1, 0, Math.PI * 2);
  ctx.fill();

  // Stripe 1: Violet
  ctx.fillStyle = '#8B5CF6';
  ctx.beginPath();
  ctx.ellipse(-50, -10, 25, 75, 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Stripe 2: Orange
  ctx.fillStyle = '#F97316';
  ctx.beginPath();
  ctx.ellipse(0, -15, 25, 80, 0.1, 0, Math.PI * 2);
  ctx.fill();

  // Stripe 3: Yellow
  ctx.fillStyle = '#FBBF24';
  ctx.beginPath();
  ctx.ellipse(50, -15, 25, 75, -0.1, 0, Math.PI * 2);
  ctx.fill();

  // White Belly Patch in Middle (Key test for "Putih di Tengah TIDAK Transparan"!)
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.ellipse(5, 25, 45, 30, 0, 0, Math.PI * 2);
  ctx.fill();

  // White Star on Chest/Center
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  const starRadius = 14;
  for (let s = 0; s < 10; s++) {
    const angle = (s * Math.PI) / 5 - Math.PI / 2;
    const r = s % 2 === 0 ? starRadius : starRadius * 0.45;
    const sx = -20 + Math.cos(angle) * r;
    const sy = 15 + Math.sin(angle) * r;
    if (s === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.closePath();
  ctx.fill();

  // Back Crest spikes
  const crestColors = ['#EC4899', '#F43F5E', '#F97316', '#EAB308', '#10B981', '#06B6D4'];
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = crestColors[i];
    ctx.beginPath();
    const x = -80 + i * 28;
    const y = -85 - Math.sin(i * 0.5) * 12;
    ctx.moveTo(x - 12, y + 10);
    ctx.lineTo(x, y - 25);
    ctx.lineTo(x + 12, y + 10);
    ctx.closePath();
    ctx.fill();
  }

  // Head
  ctx.fillStyle = '#06B6D4'; // Cyan head
  ctx.beginPath();
  ctx.ellipse(120, -20, 65, 55, -0.2, 0, Math.PI * 2);
  ctx.fill();

  // Snout
  ctx.fillStyle = '#059669';
  ctx.beginPath();
  ctx.moveTo(150, -40);
  ctx.quadraticCurveTo(205, -30, 210, 0);
  ctx.quadraticCurveTo(170, 25, 140, 15);
  ctx.closePath();
  ctx.fill();

  // Eye cone
  ctx.fillStyle = '#8B5CF6';
  ctx.beginPath();
  ctx.arc(125, -30, 32, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#F59E0B';
  ctx.beginPath();
  ctx.arc(125, -30, 22, 0, Math.PI * 2);
  ctx.fill();

  // Eye Pupil (Dark)
  ctx.fillStyle = '#0F172A';
  ctx.beginPath();
  ctx.arc(130, -32, 12, 0, Math.PI * 2);
  ctx.fill();

  // Eye reflection (white pupil highlight)
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(133, -35, 4, 0, Math.PI * 2);
  ctx.fill();

  // Feet
  ctx.fillStyle = '#047857';
  // Front foot
  ctx.beginPath();
  ctx.ellipse(70, 100, 22, 35, 0.2, 0, Math.PI * 2);
  ctx.fill();
  // Back foot
  ctx.beginPath();
  ctx.ellipse(-60, 95, 22, 35, -0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  return canvas.toDataURL('image/png');
}

function createToucanLogo(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 600;
  const ctx = canvas.getContext('2d')!;

  // Pure white background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, 600, 600);

  ctx.save();
  ctx.translate(300, 300);

  // Circular backdrop gradient disk
  const diskGrad = ctx.createLinearGradient(0, -220, 0, 220);
  diskGrad.addColorStop(0, '#F43F5E'); // Rose
  diskGrad.addColorStop(0.35, '#FB923C'); // Orange
  diskGrad.addColorStop(0.7, '#FACC15'); // Yellow
  diskGrad.addColorStop(1, '#06B6D4'); // Cyan

  ctx.fillStyle = diskGrad;
  ctx.beginPath();
  ctx.arc(0, 0, 210, 0, Math.PI * 2);
  ctx.fill();

  // Tropical palm silhouette
  ctx.fillStyle = '#0F172A';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.ellipse(-80 + i * 40, 150 - i * 20, 160, 20, (-30 + i * 15) * (Math.PI / 180), 0, Math.PI * 2);
    ctx.fill();
  }

  // Toucan Body
  ctx.fillStyle = '#1E1B4B'; // Deep navy black
  ctx.beginPath();
  ctx.ellipse(30, 40, 75, 110, -0.15, 0, Math.PI * 2);
  ctx.fill();

  // Throat bib
  ctx.fillStyle = '#FEF08A'; // Soft yellow
  ctx.beginPath();
  ctx.ellipse(-10, 20, 45, 55, -0.1, 0, Math.PI * 2);
  ctx.fill();

  // Crimson throat border
  ctx.fillStyle = '#EF4444';
  ctx.beginPath();
  ctx.ellipse(0, 55, 30, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  // Beak (Vibrant multi-color)
  ctx.fillStyle = '#EAB308'; // Amber yellow
  ctx.beginPath();
  ctx.moveTo(-20, -30);
  ctx.quadraticCurveTo(-150, -40, -180, 40);
  ctx.quadraticCurveTo(-90, 50, -20, 25);
  ctx.closePath();
  ctx.fill();

  // Beak tip orange
  ctx.fillStyle = '#EA580C';
  ctx.beginPath();
  ctx.moveTo(-140, -10);
  ctx.quadraticCurveTo(-150, -40, -180, 40);
  ctx.quadraticCurveTo(-130, 45, -140, -10);
  ctx.closePath();
  ctx.fill();

  // Beak bottom cyan stripe
  ctx.fillStyle = '#06B6D4';
  ctx.beginPath();
  ctx.moveTo(-90, 35);
  ctx.lineTo(-20, 25);
  ctx.lineTo(-40, 10);
  ctx.closePath();
  ctx.fill();

  // Eye
  ctx.fillStyle = '#38BDF8';
  ctx.beginPath();
  ctx.arc(-5, -10, 15, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#020617';
  ctx.beginPath();
  ctx.arc(-5, -10, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(-3, -12, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  return canvas.toDataURL('image/png');
}

function createCyberBadge(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 600;
  const ctx = canvas.getContext('2d')!;

  // White background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, 600, 600);

  ctx.save();
  ctx.translate(300, 300);

  // Outer Hexagon
  const drawHex = (r: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3 - Math.PI / 6;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  };

  drawHex(220, '#4F46E5'); // Indigo
  drawHex(195, '#06B6D4'); // Cyan
  drawHex(175, '#1E1B4B'); // Dark Navy

  // Inner multi-color geometric triangles
  ctx.fillStyle = '#F43F5E';
  ctx.beginPath();
  ctx.moveTo(0, -140);
  ctx.lineTo(100, 20);
  ctx.lineTo(0, -10);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#10B981';
  ctx.beginPath();
  ctx.moveTo(0, -140);
  ctx.lineTo(-100, 20);
  ctx.lineTo(0, -10);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#F59E0B';
  ctx.beginPath();
  ctx.moveTo(-100, 20);
  ctx.lineTo(0, 140);
  ctx.lineTo(0, -10);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#8B5CF6';
  ctx.beginPath();
  ctx.moveTo(100, 20);
  ctx.lineTo(0, 140);
  ctx.lineTo(0, -10);
  ctx.closePath();
  ctx.fill();

  // Center diamond
  ctx.fillStyle = '#EC4899';
  ctx.beginPath();
  ctx.moveTo(0, -45);
  ctx.lineTo(45, 0);
  ctx.lineTo(0, 45);
  ctx.lineTo(-45, 0);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
  return canvas.toDataURL('image/png');
}

function createBotanicalArt(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 600;
  const ctx = canvas.getContext('2d')!;

  // Clean cream/white background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, 600, 600);

  ctx.save();
  ctx.translate(300, 300);

  // Big Terracotta sun
  ctx.fillStyle = '#C2410C';
  ctx.beginPath();
  ctx.arc(60, -50, 150, 0, Math.PI * 2);
  ctx.fill();

  // Olive green geometric arch
  ctx.fillStyle = '#65A30D';
  ctx.beginPath();
  ctx.arc(-80, 80, 110, 0, Math.PI);
  ctx.fill();

  // Gold accent circle
  ctx.fillStyle = '#EAB308';
  ctx.beginPath();
  ctx.arc(-100, -120, 50, 0, Math.PI * 2);
  ctx.fill();

  // Dark charcoal monstera stem & leaves
  ctx.fillStyle = '#1C1917';
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#1C1917';
  ctx.beginPath();
  ctx.moveTo(-120, 230);
  ctx.quadraticCurveTo(0, 50, 100, -210);
  ctx.stroke();

  // Leaves
  const leafData = [
    { x: -10, y: -100, rx: 90, ry: 40, rot: -0.6 },
    { x: 80, y: -70, rx: 85, ry: 35, rot: 0.4 },
    { x: -40, y: 30, rx: 95, ry: 42, rot: -0.5 },
    { x: 60, y: 60, rx: 90, ry: 38, rot: 0.5 },
    { x: -70, y: 160, rx: 100, ry: 45, rot: -0.4 },
  ];

  for (const l of leafData) {
    ctx.beginPath();
    ctx.ellipse(l.x, l.y, l.rx, l.ry, l.rot, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
  return canvas.toDataURL('image/png');
}

function createGeometricFacetGem(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 600;
  const ctx = canvas.getContext('2d')!;

  // Clean solid white background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, 600, 600);

  ctx.save();
  ctx.translate(300, 300);

  // Facet 1: Emerald Green (#10B981)
  ctx.fillStyle = '#10B981';
  ctx.beginPath();
  ctx.moveTo(0, -180);
  ctx.lineTo(-120, -70);
  ctx.lineTo(0, -50);
  ctx.closePath();
  ctx.fill();

  // Facet 2: Lime Green (#84CC16)
  ctx.fillStyle = '#84CC16';
  ctx.beginPath();
  ctx.moveTo(-120, -70);
  ctx.lineTo(-170, 40);
  ctx.lineTo(-40, 20);
  ctx.lineTo(0, -50);
  ctx.closePath();
  ctx.fill();

  // Facet 3: Teal (#14B8A6)
  ctx.fillStyle = '#14B8A6';
  ctx.beginPath();
  ctx.moveTo(-170, 40);
  ctx.lineTo(-100, 160);
  ctx.lineTo(0, 70);
  ctx.lineTo(-40, 20);
  ctx.closePath();
  ctx.fill();

  // Facet 4: Cyan (#06B6D4)
  ctx.fillStyle = '#06B6D4';
  ctx.beginPath();
  ctx.moveTo(-100, 160);
  ctx.lineTo(0, 200);
  ctx.lineTo(0, 70);
  ctx.closePath();
  ctx.fill();

  // Facet 5: Royal Blue (#2563EB)
  ctx.fillStyle = '#2563EB';
  ctx.beginPath();
  ctx.moveTo(0, 200);
  ctx.lineTo(100, 160);
  ctx.lineTo(0, 70);
  ctx.closePath();
  ctx.fill();

  // Facet 6: Indigo / Violet (#6366F1)
  ctx.fillStyle = '#6366F1';
  ctx.beginPath();
  ctx.moveTo(100, 160);
  ctx.lineTo(170, 40);
  ctx.lineTo(40, 20);
  ctx.lineTo(0, 70);
  ctx.closePath();
  ctx.fill();

  // Facet 7: Purple / Magenta (#A855F7)
  ctx.fillStyle = '#A855F7';
  ctx.beginPath();
  ctx.moveTo(170, 40);
  ctx.lineTo(120, -70);
  ctx.lineTo(0, -50);
  ctx.lineTo(40, 20);
  ctx.closePath();
  ctx.fill();

  // Facet 8: Ruby Red (#EF4444)
  ctx.fillStyle = '#EF4444';
  ctx.beginPath();
  ctx.moveTo(0, -180);
  ctx.lineTo(120, -70);
  ctx.lineTo(0, -50);
  ctx.closePath();
  ctx.fill();

  // Facet 9: Amber / Orange center top (#F59E0B)
  ctx.fillStyle = '#F59E0B';
  ctx.beginPath();
  ctx.moveTo(0, -50);
  ctx.lineTo(-40, 20);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();

  // Facet 10: Golden center (#FBBF24)
  ctx.fillStyle = '#FBBF24';
  ctx.beginPath();
  ctx.moveTo(0, -50);
  ctx.lineTo(0, 0);
  ctx.lineTo(40, 20);
  ctx.closePath();
  ctx.fill();

  // Facet 11: Pure White Inner Glint
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-30, 25);
  ctx.lineTo(0, 60);
  ctx.lineTo(30, 25);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
  return canvas.toDataURL('image/png');
}

export const SAMPLE_IMAGES: SampleImage[] = [
  {
    id: 'sample-mecha-magenta',
    name: 'cyber_mecha_badge.png',
    category: 'Bg Magenta #FF00FF (Uji Utama)',
    description: 'Emblem robotik dengan background Magenta #FF00FF, sayap Merah #FF0000 utuh, dan mata/bintang Putih solid!',
    hasWhiteBg: false,
    bgType: 'magenta',
    getDataUrl: createCyberMechaSticker,
  },
  {
    id: 'sample-gem-facets',
    name: 'geometric_polygon_gem.png',
    category: 'Facet Geometris (Bg Putih)',
    description: 'Batu permata poligon dengan facet hijau, teal, cyan, biru, ungu, & kilau putih tengah.',
    hasWhiteBg: true,
    bgType: 'white',
    getDataUrl: createGeometricFacetGem,
  },
  {
    id: 'sample-chameleon',
    name: 'chameleon_color_sticker.png',
    category: 'Stiker Multi-Warna (Bg Putih)',
    description: 'Bunglon multi-warna dengan perut & bintang putih di tengah (Uji opsi putih tengah tetap solid & background transparan!)',
    hasWhiteBg: true,
    bgType: 'white',
    getDataUrl: createChameleonSticker,
  },
  {
    id: 'sample-toucan',
    name: 'tropical_toucan_sunset.png',
    category: 'Gradasi & Siluet (Bg Putih)',
    description: 'Burung tukan dengan paruh gradasi warna-warni dan cakram sunset',
    hasWhiteBg: true,
    bgType: 'white',
    getDataUrl: createToucanLogo,
  },
  {
    id: 'sample-badge',
    name: 'cyber_shield_hexagon.png',
    category: 'Logo Geometris (Bg Putih)',
    description: 'Emblem heksagonal tajam dengan 6 layer warna kontras',
    hasWhiteBg: true,
    bgType: 'white',
    getDataUrl: createCyberBadge,
  },
  {
    id: 'sample-botanical',
    name: 'boho_botanical_print.png',
    category: 'Flat Art / Cetak (Bg Putih)',
    description: 'Karya seni modern minimalis terracotta, olive, emas, dan charcoal',
    hasWhiteBg: true,
    bgType: 'white',
    getDataUrl: createBotanicalArt,
  },
];
