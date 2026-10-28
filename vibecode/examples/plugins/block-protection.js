module.exports = {
  name: 'lobby-protection',
  onEnable(api) {
    api.events.on('blockBreak', ({ world }) => world.name !== 'lobby');
    api.events.on('blockPlace', ({ world }) => world.name !== 'lobby');

    api.commands.register({
      name: 'lobby',
      description: 'Return to the lobby.',
      async execute({ sender, reply }) {
        if (!await api.server.changeWorld(sender.name, 'lobby')) {
          reply('The lobby world is not available.');
        }
      },
    });

  },
};
