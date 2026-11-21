// How a to-do's owner reads in words: "the user", "cos" or a thread.
export const ownerText = (owner: string): string => (owner === 'patrick' || owner === 'user' ? 'the user' : owner);
