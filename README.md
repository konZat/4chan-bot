# 4chan-bot
[![npm](https://img.shields.io/npm/v/4chan-bot)](https://www.npmjs.com/package/4chan-bot)
[![npm download count](https://img.shields.io/npm/dm/4chan-bot)](https://www.npmjs.com/package/4chan-bot)
[![MIT License](https://img.shields.io/npm/l/4chan-bot)](#license)
![Stargazers](https://img.shields.io/github/stars/konZat/4chan-bot)
![Forks](https://img.shields.io/github/forks/konZat/4chan-bot)

A 4chan bot for automatically replying to and creating threads using puppeteer.

## Table of Contents

- [Important Notes](#important-notes)
- [Features](#features)
- [How It Works](#how-it-works)
- [Installation](#installation)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Example](#headful-example)
- [TODO](#todo)
- [License](#license)

## Important Notes
- Captcha solving is dependant upon [4chan-captcha-solver](https://github.com/drunohazarb/4chan-captcha-solver). If 4chan changes the captcha and the solver no longer works, then this package will not work until 4chan-captcha-solver and this package are updated.
- The package works without proxies, but if you are using multiple bots at the same time it is recommended to use proxies. 
  - It is highly reccomended to use a rotating residential proxy, as it allows you to easily run many bots and negates bans.
    - It is worth noting that 4chan is strict with the IPs they allow to post. I have tried several different proxy providers and only found one that works. Even then, some of the IPs get flagged and stuck in an infinite cloudflare loop or are already banned.
- This package is dependant upon the current layout of 4chan, and the steps required to post. If these change, the bot will not work until it is updated.
  - Ex. The way Cloudflare turnstile works changes, or layout / important element IDs change
- Each bot instance is a seperate browser, that uses about ~150-300 MB RAM
- The package is a bit thrown together, so you may encounter other issues.

### New Antispam
4chan has recently ~~been rolling out new antispam rules to some boards~~ rolled out new antispam rules to all boards. These rules require that the user either wait 15 minutes to make their first post, or verify their email (or buy a pass). 

There are several possible ways to handle this:
- Just wait 15 minutes. 
  - There is no cooldown after the 15 minutes is up. This means that the initial cooldown for threads is only increased by 3x (from 5 min to 15 min), and 15x for replies (1 min to 15 min).
  - If your usecase isn't spam, then this doesn't matter much if you expect to make many posts before being banned (As you only need to wait the 15 minutes once, future threads/replys have the normal 300s / 60s cooldown).
  - If you need to rapdily post, wait 15 minutes with many bot instances open.
    - Ex. 50 headless bots at once with a rotating residential proxy
- Run many browser instances specifically to 'farm' lots of bypassed cookies in advance of when you need to rapidly post.
  - Ex. Reply to a random post on a board such as /b/ (waiting the 15 minutes), then save the cookies and destroy the bot. When you're ready to post on a board with antispam, import the cookies and you should be able to post without the antispam cooldown.
- Use a temporary email service that supports gmail (or another whitelisted email domain) like [Emailnator](https://www.emailnator.com/), and a service like [2Captcha](https://2captcha.com/) to solve the hcaptcha, to complete the email verification automatically.
  - After verification, the time since starting the antispam cooldown is subtracted from post cooldown. This means that if you complete the verification in 60s, then after you verify the thread creation cooldown will only be 4 minutes, and the reply cooldown will be complete. So, you can have the same post throughput as before the antispam.
   - However, it may only be a temporary solution as many of the emails generated by these sites seem to follow a pattern, which 4chan may catch onto and then block.
   - Emails aren't sent out immeadiately, and appear to get added to a delayed queue. So this may add time, depending on how long the delay is.

~~Currently, neither of the latter options are implemented, and the bot will wait for the extended cooldown without any additional configuration required.~~

Currently, you can either wait the 15 minutes or import/export cookies.
<br><br>
I would recommend exporting the cookies of your bots after you are done, so you can reuse them in future to avoid the 15 minute cooldown, provided they don't get banned.

## Features

- Create new threads
- Reply to existing threads
- Handle Cloudflare challenges automatically
- Solve 4chans captcha automatically (reliant on [4chan-captcha-solver](https://github.com/drunohazarb/4chan-captcha-solver))
- Random useragents
- Proxy support
- Randomizes file names to mimic [4chan-x](https://github.com/ccd0/4chan-x)
- Randomizes image MD5 to circumvent antispam
- Set username, memeflag, etc.
- Run in headless or headful chrome

## How It Works

### Replying to threads
1. Browser is initialized with random useragent (and proxy if configured) if not already
2. Navigates to thread URL
3. If cloudflare challenge hasn't been solved, opens it in a new tab and solves it. (Required to do it once if posting on a fresh cookie)
4. Click the `Get captcha` button and waits 60s for the cooldown.
5. Click the `Get captcha` button again and waits for the captcha to load
6. Captcha gets automatically solved with [4chan-captcha-solver](https://github.com/drunohazarb/4chan-captcha-solver)
7. Uploads image if specified, fills in reply text / username etc.
8. Posts the reply. If the captcha is incorrect, the bot will retry it.

### Creating threads
1. Browser is initialized with random useragent (and proxy if configured) if not already
2. Navigates to catalog URL
3. If cloudflare challenge hasn't been solved, opens it in a new tab and solves it. (Required to do it once if posting on a fresh cookie)
4. Click the `Get captcha` button and waits 5m for the cooldown.
5. Click the `Get captcha` button again and waits for the captcha to load
6. Captcha gets automatically solved with [4chan-captcha-solver](https://github.com/drunohazarb/4chan-captcha-solver)
7. Uploads image, fills in thread text / username etc.
8. Posts the thread. If the captcha is incorrect, the bot will retry it.

## Installation

```bash
npm install 4chan-bot
```

## Usage

Basic example, without any additional configuration:

```javascript
import Bot from '4chan-bot';

const bot = new Bot();

(async () => {
  const thread = await bot.makeThread('Hello, 4chan!', 'path/to/image.jpg', 'b');

  if (thread) {
    console.log(`Thread created succesfully! Thread ID: ${thread}`);
  } else {
    console.log(`Failed to create thread. Fail reason: ${bot.cantPostReason}`);
  }
})();
```

Refer to the [API Reference](#api-reference) to see configuration options.

## API Reference

### Config
All config methods are optional.

- `constructor()`: Initialize a new bot instance
- `setMaxCloudflareAttempts(maxAttempts: number)`: Set the maximum number of Cloudflare turnstile solving attempts
  - defaults to 10
- `setHeadless(headless: boolean)`: Set whether to run in headless mode
  - defaults to `true`
- `setMaxCaptchaAttempts(maxAttempts: number)`: Set the maximum number of 4chan CAPTCHA solving attempts
  - defaults to 3
  - cooldown increases with every failed attempt
- `setUsername(username: string)`: Set the username for posts
- `setMemeflag(memeFlagId: string)`: Set a meme flag for posts
  - Find the ID by using inspect element or similar tool on the memeflag dropdown
  - Ex. `NZ` or `GY`
- `setProxy(proxy: ProxyOptions)`: Set a proxy for the bot to use
  - Type: `{ host: string, port: number, username: string, password: string }`
  - Can't be changed after the browser is initialized
- `setId(id: string)`: Set a unique identifier for the bot instance
- `async setCookies(cookies: Cookies[])`: sets cookies

### Bot
- `replyToThread(message: string, threadId: number, board: string, imagePath?: string)`: Reply to an existing thread
  - `board` is the abbreviation, such as `vt`, or `pol`
  - returns `true` if posting doesn't give an error (note that the reply may still be blackholed due to incorrect captcha or other reason)
  - returns `false` if there is an error posting, view the error on the `cantPostReason` property.
    - If the error is due to an incorrect captcha, it will retry the captcha up to `MaxCaptchaAttempts` times.
- `makeThread(message: string, imagePath: string, board: string)`: Create a new thread
  - `board` is the abbreviation, such as `vt`, or `pol` 
  - returns the thread ID (string) if the post is successful
  - returns `false` if there is an error posting, view the error on the `cantPostReason` property.
    - If the error is due to an incorrect captcha, it will retry the captcha up to `MaxCaptchaAttempts` times.
   
- `destroyBot()`: Destroys the bot / closes the browser

### Other
- `canPost: boolean`: whether or not the bot can post
  - false if its encountered some error
- `cantPostReason: string`: reason for the bot being unable to post (if `canPost` is false)
  - examples include ban, range ban etc.
- `isDestroyed: boolean`: whether or not `destroyBot()` has been called
- `id?: string`: the id, set by `setId()`
- `getCookies()`: returns array of cookies

## Headful Example

<p align="center">
  <video src='https://github.com/user-attachments/assets/5adb8ead-b092-4649-bc2a-c5de59e47fc1' width=600></video>
  <br/>
  <sub>Posting a reply + thread in headful mode</sub>
</p>

## TODO
- [ ] Fix cookies, cooldown not bypassed with new antispam update
- [ ] 4chan pass support
- [ ] Fix memeflags

## License

This project is licensed under the MIT License. See the [LICENSE](/LICENSE) file for details.
