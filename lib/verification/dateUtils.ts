export function daysBetween(fromDate: string, toDate: string): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((new Date(toDate).getTime() - new Date(fromDate).getTime()) / msPerDay);
}

export function hasDatePassed(date: string, referenceDate: string): boolean {
  return new Date(referenceDate).getTime() >= new Date(date).getTime();
}
