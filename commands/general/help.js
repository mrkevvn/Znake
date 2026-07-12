'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { buildOverview } = require('../../handlers/helpComponents');

module.exports = {
  name: "help",
  category: "user",
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Browse all available bot commands interactively.'),

  cooldown: 5,

  async execute(interaction, client) {
    return interaction.reply(buildOverview(client));
  },
};
