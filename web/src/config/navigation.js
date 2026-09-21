// Preserve the original modules and extend with data management.
export const systemModules = [
  { key: 'globe', path: '/globe', title: '三维地球', english: '3D EARTH', available: true },
  {
    key: 'monitor',
    path: '/ionosphere',
    title: '三维电离层',
    english: '3D IONOSPHERE',
    available: true,
  },
  {
    key: 'analysis',
    path: '/analysis',
    title: '数据分析',
    english: 'DATA ANALYSIS',
    available: true,
  },
  {
    key: 'temporal',
    path: '/time-variation',
    title: '时空变化',
    english: 'SPATIOTEMPORAL VARIATION',
    available: true,
  },
  { key: 'forecast', path: '/forecast', title: '预报预警', english: 'FORECAST & WARNING' },
  { key: 'satellites', path: '/satellites', title: '卫星轨道', english: 'SATELLITE ORBITS' },
  { key: 'layers', path: '/layers', title: '地图图层', english: 'MAP LAYERS' },
  { key: 'settings', path: '/settings', title: '系统设置', english: 'SYSTEM SETTINGS' },
  {
    key: 'datasets',
    path: '/data-management',
    title: '数据管理',
    english: 'DATA MANAGEMENT',
    available: true,
  },
]
