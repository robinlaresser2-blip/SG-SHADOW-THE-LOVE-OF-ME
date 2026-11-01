function sameMaps(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length > 0 &&
    left.length === right.length && left.every((map, i) =>
      typeof map?.Id === 'string' && map.Id.length > 0 && map.Id === right[i]?.Id);
}

function selectMap(season, rankId, random = Math.random) {
  const pool = season.MapPools?.find(p => rankId >= p.RankIdFrom && rankId <= p.RankIdTo);
  const maps = (pool?.Maps || []).filter(m => typeof m.MapId === 'string' && m.MapId.length > 0 &&
    Number.isFinite(m.Weight) && m.Weight > 0);
  const total = maps.reduce((sum, m) => sum + m.Weight, 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  let choice = random() * total;
  for (const map of maps) {
    choice -= map.Weight;
    if (choice < 0) return map;
  }
  return maps[maps.length - 1];
}
module.exports = { sameMaps, selectMap };
