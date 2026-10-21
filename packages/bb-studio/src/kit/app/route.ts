// The app's current path. BB's router changes it without telling plugins, so
// this follows the Navigation API's events where the shell has them and polls
// as a fallback. A `useRoute()` hook from BB would replace it.
import { useEffect, useState } from "react";

const POLL_MS = 400;

interface NavigationTarget {
  addEventListener(type: "navigatesuccess" | "currententrychange", listener: () => void): void;
  removeEventListener(type: "navigatesuccess" | "currententrychange", listener: () => void): void;
}

export function usePathname(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const check = () => setPath(window.location.pathname);
    const navigation = (window as { navigation?: NavigationTarget }).navigation;
    navigation?.addEventListener("currententrychange", check);
    window.addEventListener("popstate", check);
    const timer = setInterval(check, POLL_MS);
    return () => {
      navigation?.removeEventListener("currententrychange", check);
      window.removeEventListener("popstate", check);
      clearInterval(timer);
    };
  }, []);
  return path;
}
