module.exports = {
  name: 'spawn-protection',
  version: '1.0.0',

  onEnable(api) {
    const radius = 8;

    api.on('block:break', (event) => {
      if (Math.hypot(event.x + 0.5, event.z + 0.5) <= radius) {
        event.cancelled = true;
      }
    });

    api.on('block:place', (event) => {
      if (Math.hypot(event.x + 0.5, event.z + 0.5) <= radius) {
        event.cancelled = true;
      }
    });

    api.on('packet:outbound:Chat', ({ packet }) => {
      if (packet.strings?.[0]) packet.strings[0] = `[Server] ${packet.strings[0]}`;
    });
  },

  onDisable() {
    console.log('[spawn-protection] disabled');
  },
};
