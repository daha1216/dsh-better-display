import { spawn } from "node:child_process";
import { statSync } from "node:fs";
//#region src/dsh-better-display.ts
const MAX_BODY_BYTES = 64 * 1024;
function sendJson(res, status, value) {
	res.setHeader("Content-Type", "application/json");
	res.statusCode = status;
	res.end(JSON.stringify(value));
}
function isTrustedRevealRequest(req) {
	const host = req.headers.host;
	if (typeof host !== "string" || host === "") return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	if (hostUrl.username !== "" || hostUrl.password !== "" || hostUrl.pathname !== "/" || hostUrl.search !== "" || hostUrl.hash !== "") return false;
	const hostname = hostUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");
	const loopback = hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "::1" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
	if (!loopback) return false;
	if (String(req.headers["sec-fetch-site"] ?? "").toLowerCase() === "cross-site") return false;
	const origin = req.headers.origin;
	if (origin !== undefined) {
		let originUrl;
		try {
			originUrl = new URL(origin);
		} catch {
			return false;
		}
		if (originUrl.host !== hostUrl.host) return false;
	}
	return true;
}
let revealSpawn = (targetPath) => {
	if (process.platform === "darwin") spawn("open", ["-R", targetPath], {
		detached: true,
		stdio: "ignore"
	});
	else if (process.platform === "win32") spawn("explorer.exe", [`/select,${targetPath}`], {
		detached: true,
		stdio: "ignore"
	});
	else spawn("xdg-open", [targetPath], {
		detached: true,
		stdio: "ignore"
	});
};
const name = "dsh-better-display";
const inject = ["webServer"];
function apply(ctx) {
	console.log("[my-plugins/dsh-better-display] loaded");
	if (ctx.webServer) ctx.effect(() => {
		return ctx.webServer.register({
			kind: "exact",
			path: "/better-display/reveal",
			handler: async (req, res) => {
				if (req.method !== "POST") {
					res.statusCode = 405;
					res.end();
					return;
				}
				if (!isTrustedRevealRequest(req)) {
					sendJson(res, 403, { ok: false, error: "forbidden" });
					return;
				}
				const contentType = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
				if (contentType !== "application/json") {
					sendJson(res, 415, { ok: false, error: "Content-Type must be application/json" });
					return;
				}
				const declared = Number(req.headers["content-length"] ?? "0");
				if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
					sendJson(res, 413, { ok: false, error: "payload too large" });
					req.destroy();
					return;
				}
				let body = "";
				let size = 0;
				let oversized = false;
				req.on("data", (chunk) => {
					if (oversized) return;
					size += chunk.length;
					if (size > MAX_BODY_BYTES) {
						oversized = true;
						sendJson(res, 413, { ok: false, error: "payload too large" });
						req.destroy();
						return;
					}
					body += chunk;
				});
				req.on("end", () => {
					if (oversized) return;
					try {
						const data = JSON.parse(body);
						const targetPath = typeof data.path === "string" ? data.path.trim() : "";
						if (!targetPath) {
							sendJson(res, 400, { ok: false, error: "Empty path" });
							return;
						}
						try {
							statSync(targetPath);
						} catch {
							sendJson(res, 404, { ok: false, error: "Path not found" });
							return;
						}
						revealSpawn(targetPath);
						sendJson(res, 200, { ok: true });
					} catch (err) {
						sendJson(res, 400, { ok: false, error: String(err) });
					}
				});
			}
		});
	}, "dsh-better-display: /api/better-display/reveal route");
}
const __test = {
	setRevealSpawn(fn) {
		revealSpawn = fn;
	},
	resetRevealSpawn() {
		revealSpawn = (targetPath) => {
			if (process.platform === "darwin") spawn("open", ["-R", targetPath], { detached: true, stdio: "ignore" });
			else if (process.platform === "win32") spawn("explorer.exe", [`/select,${targetPath}`], { detached: true, stdio: "ignore" });
			else spawn("xdg-open", [targetPath], { detached: true, stdio: "ignore" });
		};
	}
};
//#endregion
export { apply, inject, name, isTrustedRevealRequest, __test };
