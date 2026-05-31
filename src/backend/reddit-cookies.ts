import { execFileSync, spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const CHROME_COOKIES = path.join(os.homedir(), "Library/Application Support/Google/Chrome/Default/Cookies");
const CHROME_SAFE_KEY_FILE = "/tmp/chrome_safe_key";
const COOKIE_DB_COPY = "/tmp/proxy-chrome-cookies.sqlite";
const REDDIT_COOKIE_REFRESH_MS = Number(process.env.REDDIT_COOKIE_REFRESH_MS ?? 60_000);
const REDDIT_CHROME_TOUCH_MS = Number(process.env.REDDIT_CHROME_TOUCH_MS ?? 10 * 60_000);

let cachedCookieHeader = "";
let cachedCookieCount = 0;
let lastCookieRefresh = 0;
let refreshInFlight = false;

function run(command: string, args: string[], input?: Buffer): Buffer {
   return execFileSync(command, args, { input, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
}

function getChromeSafeStorageKey(): Buffer {
   if (fs.existsSync(CHROME_SAFE_KEY_FILE) && fs.statSync(CHROME_SAFE_KEY_FILE).size > 0) {
      return Buffer.from(fs.readFileSync(CHROME_SAFE_KEY_FILE, "utf8").trimEnd(), "utf8");
   }

   // This often requires Keychain approval from the GUI session. If it fails, run the export helper manually once.
   return Buffer.from(
      run("security", ["find-generic-password", "-a", "Chrome", "-s", "Chrome Safe Storage", "-w"])
         .toString("utf8")
         .trimEnd(),
      "utf8",
   );
}

function decryptChromeCookie(host: string, encryptedHex: string, aesKey: Buffer): string {
   let encrypted = Buffer.from(encryptedHex, "hex");
   if (encrypted.subarray(0, 3).toString() === "v10" || encrypted.subarray(0, 3).toString() === "v11") {
      encrypted = encrypted.subarray(3);
   }

   const iv = Buffer.alloc(16, " ");
   const decrypted = run(
      "openssl",
      ["enc", "-d", "-aes-128-cbc", "-K", aesKey.toString("hex"), "-iv", iv.toString("hex")],
      encrypted,
   );

   // Chrome cookie DB version >= 24 prefixes encrypted cookie values with SHA256(host_key).
   const hostHash = crypto.createHash("sha256").update(host).digest();
   const value = decrypted.subarray(0, 32).equals(hostHash) ? decrypted.subarray(32) : decrypted;
   return value.toString("utf8").replace(/[\r\n]/g, "");
}

export function isRedditHost(hostname: string): boolean {
   return hostname === "reddit.com" || hostname.endsWith(".reddit.com");
}

export function getRedditCookieHeader(): string {
   return cachedCookieHeader;
}

export function getRedditCookieStatus() {
   return {
      cookieCount: cachedCookieCount,
      hasCookies: cachedCookieHeader.length > 0,
      lastRefresh: lastCookieRefresh ? new Date(lastCookieRefresh).toISOString() : null,
      refreshInFlight,
   };
}

export async function refreshRedditCookies(): Promise<void> {
   if (refreshInFlight) return;
   refreshInFlight = true;
   try {
      if (!fs.existsSync(CHROME_COOKIES)) throw new Error(`Chrome cookie DB not found: ${CHROME_COOKIES}`);
      fs.copyFileSync(CHROME_COOKIES, COOKIE_DB_COPY);

      const safeStoragePassword = getChromeSafeStorageKey();
      const aesKey = crypto.pbkdf2Sync(safeStoragePassword, "saltysalt", 1003, 16, "sha1");

      const query = `select host_key,name,value,hex(encrypted_value) from cookies where host_key like '%reddit.com' order by host_key,name;`;
      const output = run("sqlite3", ["-separator", "\t", COOKIE_DB_COPY, query]).toString("utf8");
      const parts: string[] = [];

      for (const line of output.split("\n")) {
         if (!line.trim()) continue;
         const [host, name, value, encryptedHex] = line.split("\t");
         if (!host || !name) continue;
         const cookieValue = value || (encryptedHex ? decryptChromeCookie(host, encryptedHex, aesKey) : "");
         if (!cookieValue) continue;
         parts.push(`${name}=${cookieValue}`);
      }

      cachedCookieHeader = parts.join("; ");
      cachedCookieCount = parts.length;
      lastCookieRefresh = Date.now();
      console.log(`[reddit-cookies] refreshed ${cachedCookieCount} cookies (${cachedCookieHeader.length} bytes)`);
   } catch (e) {
      console.error("[reddit-cookies] refresh failed", e);
   } finally {
      refreshInFlight = false;
   }
}

export function touchRedditInChrome(): void {
   const script = `
tell application "Google Chrome"
    set w to make new window
    set URL of active tab of w to "https://www.reddit.com/"
    delay 10
    close w
end tell
`;
   const child = spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" });
   child.unref();
   console.log("[reddit-cookies] touched reddit in Chrome");
}

export function startRedditCookieAutomation(): void {
   void refreshRedditCookies();
   setInterval(() => void refreshRedditCookies(), REDDIT_COOKIE_REFRESH_MS).unref();

   if (REDDIT_CHROME_TOUCH_MS > 0) {
      setInterval(() => {
         touchRedditInChrome();
         setTimeout(() => void refreshRedditCookies(), 15_000).unref();
      }, REDDIT_CHROME_TOUCH_MS).unref();
   }
}
