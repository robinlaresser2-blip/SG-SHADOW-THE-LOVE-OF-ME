const { WebhookClient, EmbedBuilder } = require("discord.js");

function DiscordEmbed(title, description, color, footer, thumbnail, image, url, author, fields, timestamp) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description);

  if (color) embed.setColor(color);
  if (footer) embed.setFooter({ text: footer });
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (image) embed.setImage(image);
  if (url) embed.setURL(url);
  if (author) embed.setAuthor(typeof author === "string" ? { name: author } : author);
  if (fields && Array.isArray(fields)) embed.addFields(fields);
  if (timestamp) embed.setTimestamp(timestamp === true ? new Date() : timestamp);

  return embed;
}

async function SendDiscordEmbed(webhookUrl, title, description, color, footer, thumbnail, image, url, author, fields, timestamp) {
  const webhook = new WebhookClient({ url: webhookUrl });
  const embed = DiscordEmbed(title, description, color, footer, thumbnail, image, url, author, fields, timestamp);
  await webhook.send({ embeds: [embed] });
}

module.exports = { DiscordEmbed, SendDiscordEmbed };
