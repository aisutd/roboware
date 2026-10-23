// Battery level colour shared by the map pucks and the robots panel.
export const batteryColor = (level) => (level > 50 ? 'var(--green)' : level > 20 ? 'var(--amber)' : 'var(--red)');
