const PRODUCTION_DEPARTMENTS = new Set(["egais", "bottling", "laboratory", "warehouse", "blending"]);
const OFFICE_DEPARTMENTS = new Set(["administration", "accounting", "operations", "hr"]);

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

export function classifyStaffing({ count = 0, members = 0, missing = 0, known = true } = {}) {
  const normalizedCount = Math.max(0, numeric(count));
  const normalizedMembers = Math.max(0, numeric(members));
  const normalizedMissing = Math.max(0, numeric(missing));
  if (!known || normalizedMembers === 0 || normalizedMissing >= normalizedMembers) {
    return { status:"unknown", count:normalizedCount, label:"Нет данных" };
  }
  if (normalizedCount === 0) return { status:"empty", count:0, label:"На смене никого нет" };
  if (normalizedCount === 1) return { status:"minimum", count:1, label:"Минимальный состав" };
  return { status:"staffed", count:normalizedCount, label:"Укомплектовано" };
}

function aggregate(rows) {
  return rows.reduce((result, row) => ({
    count:result.count + numeric(row?.on_shift_count),
    members:result.members + numeric(row?.member_count),
    missing:result.missing + numeric(row?.schedule_missing_count),
  }), { count:0, members:0, missing:0 });
}

function isChateau(row) {
  return String(row?.branch || "") === "chateau_alvisa";
}

export function buildEnterpriseStaffing(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const productionRows = list.filter((row) => isChateau(row) && PRODUCTION_DEPARTMENTS.has(String(row?.department_key || "")));
  const officeRows = list.filter((row) => isChateau(row) && OFFICE_DEPARTMENTS.has(String(row?.department_key || "")));
  const odysseyRows = list.filter((row) => String(row?.branch || "") === "contract_odyssey");
  const departments = {};

  productionRows.forEach((row) => {
    const key = String(row?.department_key || "");
    const related = productionRows.filter((item) => String(item?.department_key || "") === key);
    departments[key] = classifyStaffing({ ...aggregate(related), known:true });
  });

  const buildingState = (matchingRows) => classifyStaffing({
    ...aggregate(matchingRows),
    known:matchingRows.length > 0,
  });

  return {
    buildings: {
      production:buildingState(productionRows),
      office:buildingState(officeRows),
      odyssey:buildingState(odysseyRows),
    },
    departments,
  };
}
