function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/\s+/g, " ");
}

export function filterAuditEntries(entries, query) {
  const terms = normalize(query).split(" ").filter(Boolean);
  if (!terms.length) return Array.isArray(entries) ? entries : [];

  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    const searchable = normalize([
      entry?.actor_name,
      entry?.department_name,
      JSON.stringify(entry?.employee_changes ?? []),
      JSON.stringify(entry?.calendar_changes ?? []),
    ].join(" "));
    return terms.every((term) => searchable.includes(term));
  });
}
