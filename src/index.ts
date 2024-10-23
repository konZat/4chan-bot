import { Browser, Cookie, Page } from "puppeteer";
import { connect, ProxyOptions } from "puppeteer-real-browser";
import UserAgent from "user-agents";
import { createAndModifyTempImage, sleep } from "./utils/utils.js";
import SOLVER from "./data/solver.js";
import fs from "fs/promises";

export default class Bot {
	private browser: Browser;
	private chanPage: Page;
	private userAgent: string;

	private board: string;
	private thread: number;

	public canPost: boolean;
	public cantPostReason?: string;

	private isCloudflareDone: boolean;
	public isDestroyed: boolean;

	// Config
	public id?: string;
	private username?: string;
	private memeFlagId?: string;
	private proxy?: ProxyOptions;
	private headless: boolean;
	private maxCaptchaAttempts: number;
	private maxCloudflareAttempts: number;
	private cookies?: Cookie[];

	constructor() {
		this.canPost = true;
		this.isCloudflareDone = false;
		this.isDestroyed = false;

		// Default config
		this.setMaxCaptchaAttempts(3)
		this.setMaxCaptchaAttempts(10)
		this.setHeadless(true)
	}

	public async getCookies(): Promise<Cookie[]> {
		if (!this.browser || !this.chanPage) {
			throw new Error("You need to initialize the browser first before getting cookies");
		}

		if (this.isDestroyed) {
			throw new Error("You cant get cookies after the browser is destroyed");
		}

		if (!this.board && !this.thread) {
			throw new Error("Browser needs to be on a board / thread to get cookies");
		}

		return await this.chanPage.cookies(); //Current page URL will always be 4chan
	}

	public async setCookies(cookies: Cookie[]): Promise<Bot> {
		if (this.browser || this.chanPage) {
			throw new Error("You cant set cookies after the browser is initialized");
		}

		//Redundant
		if (!this.browser || !this.chanPage) {
			await this.initBot();
		}

		if (this.isDestroyed) {
			throw new Error("You cant set cookies after the browser is destroyed");
		}

		for (const cookie of cookies) {
			if (cookie.name === "cf_clearance") {
				this.isCloudflareDone = true;
				break;
			}
		}

		//@ts-ignore
		await this.chanPage.setCookie(...cookies);

		return this;
	}

	public setMaxCloudflareAttempts(maxAttempts: number): Bot {
		this.maxCloudflareAttempts = maxAttempts;

		return this;
	}

	public setHeadless(headless: boolean): Bot {
		this.headless = headless;

		return this;
	}

	public setMaxCaptchaAttempts(maxAttempts: number): Bot {
		this.maxCaptchaAttempts = maxAttempts;

		return this;
	}

	public setUsername(username: string): Bot {
		this.username = username;

		return this;
	}

	public setMemeflag(memeFlagId: string): Bot {
		this.memeFlagId = memeFlagId;

		return this;
	}

	public setProxy(proxy: ProxyOptions): Bot {
		if (this.browser) {
			throw new Error("Browser is already initialized, cant change proxy");
		}

		this.proxy = proxy;

		return this;
	}

	public setId(id: string): Bot {
		this.id = id;

		return this;
	}

	// Wait for captcha button, and for it to be enabled (Same function for replying / making thread)
	private async clickCaptcha() {
		await this.chanPage
			.evaluate(async () => {
				// Wait for captcha button to be enabled
				while (document.getElementsByTagName("button")[0]?.disabled) {
					await new Promise((r) => setTimeout(r, 1000));
				}

				// Click it
				document.getElementsByTagName("button")[0].click();
			})
			.catch(() => {
				//console.log('err clicking')
			});

		return true;
	}

	// Solve initial cloudflare turnstile captcha
	private async solveCloudflare(/*threadId: number, board: string*/): Promise<boolean> {
		const cloudFlarePage = await this.browser.newPage();
		await cloudFlarePage.setUserAgent(this.userAgent);

		// thread id url param doesn't matter, gets the same cookie
		// if (!isForNewThread) {
		//     await cloudFlarePage.goto(`https://sys.4chan.org/captcha?opened=1&board=${this.board}&thread_id=${this.thread}`, { waitUntil: 'networkidle0'}).catch(() => this.destroyBot())
		//} else {
		await cloudFlarePage.goto(`https://sys.4chan.org/captcha?opened=1&board=${this.board}`, { waitUntil: "networkidle0" }).catch(() => {
			throw new Error("Failed to goto captcha url, bad proxy?");
		});
		//}

		// Solve turnstile
		try {
			let fails = 0;
			while (!cloudFlarePage.isClosed()) {
				const navigation = cloudFlarePage.waitForNavigation({ timeout: 5 * 1000 }).catch(() => null);

				for (let i = 0; i < 3; i++) {
					await cloudFlarePage.mouse.click(298, 98);
					await sleep(1000);
				}

				await navigation;

				if ((await cloudFlarePage.title()) === "") {
					break;
				}

				fails++;

				if (fails > this.maxCloudflareAttempts) {
					await this.destroyBot();
					throw new Error("IP is flagged by Cloudflare/4chan, bot destroyed");
				}
			}
		} catch (e) {
			throw new Error("Error solving turnstile");
		}

		await sleep(1000);

		await cloudFlarePage.close();

		this.isCloudflareDone = true;

		return true;
	}

	// TODO
	private async checkForCFFlag(onCatalog: boolean): Promise<boolean> {
		const isFlagged = onCatalog
			? false //alw t-frame
			: await this.chanPage.evaluate(() => document.querySelector('iframe[id="t-frame"]') !== null);

		if (isFlagged) {
			await this.destroyBot();
			throw new Error("IP is flagged by cloudflare, bot has been destroyed");
		}

		return isFlagged;
	}

	private async goToBoard(board: string): Promise<boolean> {
		await this.chanPage.goto(`https://boards.4chan.org/${board}/catalog`, { waitUntil: "networkidle2" }).catch(() => {
			throw new Error("Failed to goto captcha url, bad proxy?");
		});

		this.board = board;

		return true;
	}

	private async goToThread(threadNum: number, board?: string): Promise<boolean> {
		await this.chanPage.goto(`https://boards.4chan.org/${board ?? this.board}/thread/${threadNum}`, { waitUntil: "networkidle2" }).catch(() => {
			throw new Error("Failed to goto captcha url, bad proxy?");
		});

		if (board && board !== this.board) {
			this.board = board;
		}

		if (!board && !this.board && threadNum) {
			throw new Error("No board param. Either pass it to goToThread() or use gotoBoard() first");
		}

		this.thread = threadNum;

		return true;
	}

	private async uploadImage(uploadSelector: string, imagePath: string): Promise<string> {
		//Randomize MD5 + filename
		const tempImagePath = await createAndModifyTempImage(imagePath);

		const inputElement = await this.chanPage.$(uploadSelector); //@ts-ignore
		await inputElement.uploadFile(tempImagePath);
		
		//Fake event
		await this.chanPage.evaluate((selector) => {
			const input = document.querySelector(selector);
			const event = new Event("change", { bubbles: true }); //@ts-ignore
			input.dispatchEvent(event);
		}, uploadSelector);

		return tempImagePath;
	}

	public async destroyBot(): Promise<boolean> {
		await this.browser.close();

		this.isDestroyed = true;
		this.canPost = false;

		return true;
	}

	private async initBot(): Promise<boolean> {
		const { browser, page } = await connect({
			//@ts-ignore
			headless: this.headless ? "shell" : false,
			args: [
				// Reduce CPU/RAM usage
				"--disable-web-security",
				"--no-sandbox",
				"--disable-setuid-sandbox",
				"--disable-dev-shm-usage",
				"--disable-session-crashed-bubble",
				"--disable-accelerated-2d-canvas",
				"--no-first-run",
				"--no-zygote",
				"--noerrdialogs", // Latest chrome version popups as a white square in headful, so move it off screen
				...(this.headless ? ["--window-position=-2400,-2400"] : []),
			],
			turnstile: false,
			connectOption: {
				protocolTimeout: 0,
			},
			proxy: this.proxy,
		});

		// Use random useragent
		const userAgent = new UserAgent({ deviceCategory: "desktop" }).toString();
		await page.setUserAgent(userAgent);

		// Block images to save bandwidth
		await page.setRequestInterception(true);
		page.on("request", (request) => {
			if (request.resourceType() === "image") {
				return request.abort();
			} else {
				return request.continue();
			}
		});

		this.userAgent = userAgent; //@ts-ignore
		this.browser = browser; // @ts-ignore
		this.chanPage = page;

		return true;
	}

	public async makeThread(message: string, imagePath: string, board: string): Promise<boolean | string> {
		if (this.isDestroyed) {
			throw new Error("Browser is destroyed, cant make thread");
		}

		if (!this.browser) {
			await this.initBot();
		}

		await this.goToBoard(board);

		// Click `Make Thread` button at top of catalog
		await this.chanPage.evaluate(() => {
			document.getElementsByTagName("a")[86].click();
		});

		// Cloudflare turnstile needs to be solved once on fresh cookie
		if (!this.isCloudflareDone) {
			await this.solveCloudflare();
		}

		// Click Captcha button to start cooldown
		await this.clickCaptcha();

		// If CF turnstile is present after already solving it, then IP is flagged
		if (await this.checkForCFFlag(true)) {
			return false;
		}

		// Wait for cooldown
		await sleep(60 * 5 * 1000);

		// Inject solver
		await this.chanPage.evaluate(SOLVER);

		// Click captcha buton to get actual captcha
		await this.clickCaptcha();

		// If it gives a turnstile, IP is flagged
		if (await this.checkForCFFlag(true)) {
			return false;
		}

		const params = { message: message, username: this.username, memeflag: this.memeFlagId };
		await this.chanPage.evaluate((params) => {
			//@ts-ignore
			document.querySelector('textarea[name="com"]').value = params.message;

			if (params.username) {
				//@ts-ignore
				document.querySelectorAll('input[name="name"]')[0].value = params.username;
			}

			//TODO: memeflag
		}, params);

		//Upload image
		await this.uploadImage("#postFile", imagePath)

		// Wait for solver to finish
		await this.chanPage.evaluate(async () => {
			//@ts-ignore
			while (!document.getElementById("t-resp").value) {
				await new Promise((r) => setTimeout(r, 400));
			}
		});

		await sleep(1000);

		// Click post button
		await this.chanPage.evaluate(async () => {
			//@ts-ignore
			while (document.querySelectorAll("input[value=Post]")[0]?.disabled) {
				//0 not 1 for threads
				await new Promise((r) => setTimeout(r, 1000));
				console.log("waiting for disabled post");
			}
			await new Promise((r) => setTimeout(r, 1500)); //@ts-ignore
			document.querySelectorAll("input[value=Post]")[0].click();
		});

		//TODO: fix this garbage
		await this.chanPage.waitForNavigation({ timeout: 60 * 1000 });
		const uploadMsg = await this.chanPage.$eval("h1", (h1) => h1.textContent).catch(() => {});

		if (uploadMsg?.includes("uploaded")) {
			await this.chanPage.waitForNavigation({ timeout: 60 * 1000 });

			const threadId = this.chanPage.url().match(/\/thread\/(\d+)/);

			if (threadId) {
				return threadId[1] as string;
			}
		} else if (await this.chanPage.$eval("span[id='errmsg']", (span) => span.textContent?.includes("mistyped the CAPTCHA")).catch(() => null)) {
			let isWrongCaptcha = false;
			do {
				await this.chanPage.goBack();
				await sleep(1000 * 2);
				await this.clickCaptcha();

				await this.chanPage.evaluate(async () => {
					//@ts-ignore
					while (!document.getElementById("t-resp").value) {
						await new Promise((r) => setTimeout(r, 400));
					} 
				});

				await sleep(1000);

				await this.chanPage.evaluate(async () => {
					//@ts-ignore
					while (document.querySelectorAll("input[value=Post]")[0]?.disabled) {
						await new Promise((r) => setTimeout(r, 1000));
						console.log("waiting for disabled post");
					}
					await new Promise((r) => setTimeout(r, 1500)); //@ts-ignore
					document.querySelectorAll("input[value=Post]")[0].click();
				});

				await this.chanPage.waitForNavigation({ timeout: 60 * 1000 });

				isWrongCaptcha = (await this.chanPage.$eval("span[id='errmsg']", (span) => span.textContent?.includes("mistyped the CAPTCHA")).catch(() => null)) ? true : false;

				if (!isWrongCaptcha) {
					const uploadMsg = await this.chanPage.$eval("h1", (h1) => h1.textContent).catch(() => {});

					if (uploadMsg?.includes("uploaded")) {
						await this.chanPage.waitForNavigation({ timeout: 60 * 1000, waitUntil: "domcontentloaded" });

						const threadId = this.chanPage.url().match(/\/thread\/(\d+)/);

						if (threadId) {
							return threadId[1] as string;
						}
					}
				} //else {
				//  return false
				//  }
			} while (isWrongCaptcha);
		}

		return false;
	}

	public async replyToThread(message: string, threadId: number, board: string, imagePath?: string): Promise<boolean> {
		if (this.isDestroyed) {
			throw new Error("Browser is destroyed, cant reply to thread");
		}

		if (!this.browser) {
			await this.initBot();
		}

		/*if (board && board !== this.board) {
            this.board = board;
        }*/

		//if (threadId && threadId !== this.thread) {
		await this.goToThread(threadId, board);
		// }

		if (!this.thread && !threadId) {
			throw new Error("No thread specified in params / object");
		}

		if (!this.board && !board) {
			throw new Error("No board specified in params / object");
		}

		// Click reply button at bottom of page
		await this.chanPage.evaluate(() => {
			document.getElementsByTagName("a")[document.getElementsByTagName("a").length - 99].click();
		});

		// Cloudflare turnstile needs to be solved once on fresh cookie
		if (!this.isCloudflareDone) {
			await this.solveCloudflare();
		}

		await sleep(1000);

		// Start 60s post timer
		await this.clickCaptcha();

		await sleep(3000);

		// Check for cloudflare captcha, IP is flagged if its still there after initial solve
		const isFlagged = await this.checkForCFFlag(false);
		if (isFlagged) {
			return false;
		}

		// Wait for post timer
		await sleep(60 * 1000);

		// Insert captcha solver
		await this.chanPage.evaluate(SOLVER);

		// Fill in reply fields
		const params = { message: message, username: this.username, memeflag: this.memeFlagId };
		await this.chanPage.evaluate((params) => {
			// Set reply text
			document.getElementsByTagName("textarea")[1].value = params.message;

			// Set username
			if (params.username) {
				//@ts-ignore
				document.querySelectorAll('input[name="name"]')[1].value = params.username;
			}

			// Set memeflag
			/*if (params.memeflag) {
                const selectElements = document.querySelectorAll('select.flagSelector[name="flag"]');

                selectElements[selectElements.length - 1] //select
            }*/
		}, params);

		await sleep(300);

		const tempImagePath = imagePath ? await this.uploadImage('#qrFile', imagePath) : null;		

		await sleep(3000);

		//Check for cloudflare captcha again
		const isFlagged2 = await this.checkForCFFlag(false);
		if (isFlagged2) {
			return false;
		}

		let captchaAttempts = 0;

		// Try to reply, if there is an error and the error is mistyped captcha, repeat until exceeds maxCaptchaAttempts or successful solve
		do {
			// Click captcha
			await sleep(1000);
			await this.clickCaptcha();

			// Wait for solver to finish
			await this.chanPage.evaluate(async () => {
				//@ts-ignore
				while (!document.getElementById("t-resp").value) {
					await new Promise((r) => setTimeout(r, 400));
				}
			});

			await this.chanPage.evaluate(async () => {
				//@ts-ignore
				while (document.querySelectorAll("input[value=Post]")[1]?.disabled) {
					await new Promise((r) => setTimeout(r, 1000));
					console.log("waiting for disabled post");
				}
				await new Promise((r) => setTimeout(r, 1500)); //@ts-ignore
				document.querySelectorAll("input[value=Post]")[1].click();
			});

			// Form still in dom after close?
			await sleep(5000);

			const errorElement = await this.chanPage.$("#qrError"); //@ts-ignore
			const errorMsg = await this.chanPage.evaluate((el) => el.innerHTML, errorElement).catch(() => null);

			if (errorMsg) {
				this.cantPostReason = errorMsg;
			}

			captchaAttempts++;
		} while (this.cantPostReason?.includes("mistyped the CAPTCHA") && captchaAttempts <= this.maxCaptchaAttempts);

		if (captchaAttempts > this.maxCaptchaAttempts) {
			this.canPost = false;
			this.cantPostReason = "Failed to solve captcha, exceeded maxCaptchaAttempts";
			return false;
		}

		if (this.cantPostReason?.includes("mistyped the CAPTCHA")) {
			this.cantPostReason = undefined;
		}

		// Delete image after posted
		if (imagePath && tempImagePath) {
			await fs.unlink(tempImagePath);
		}

		return true;
	}
}
