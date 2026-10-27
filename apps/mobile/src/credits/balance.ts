/** The balance to show: a store refund after the credits were spent takes gen's balance below 0, shown as 0. */
export const displayCredits = (credits: number) => Math.max(0, credits);
