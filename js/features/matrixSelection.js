export function getMatrixSelectionBounds(a, b) {
  return !a || !b ? null : {
    minRow: Math.min(a.rowIndex, b.rowIndex), maxRow: Math.max(a.rowIndex, b.rowIndex),
    minColumn: Math.min(a.columnIndex, b.columnIndex), maxColumn: Math.max(a.columnIndex, b.columnIndex),
  };
}

export function isMatrixCellInBounds(cell, bounds) {
  return Boolean(cell && bounds
    && cell.rowIndex >= bounds.minRow && cell.rowIndex <= bounds.maxRow
    && cell.columnIndex >= bounds.minColumn && cell.columnIndex <= bounds.maxColumn);
}
