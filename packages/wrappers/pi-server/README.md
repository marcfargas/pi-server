# pi-server

> **This is a namespace reservation package.** Install [`@marcfargas/pi-server`](https://www.npmjs.com/package/@marcfargas/pi-server) for the real package.

## Why does this package exist?

This unscoped wrapper exists to prevent supply-chain attacks. Without it, a
malicious actor could publish a package named `pi-server` on npm. Anyone who
then ran `npx pi-server` without having installed the scoped package first
would unknowingly execute the attacker's code.

By holding this name, `npx pi-server` safely delegates to the real
`@marcfargas/pi-server` package.

## Usage

```bash
# These all work:
npx pi-server serve --provider google --model gemini-2.5-flash
npx @marcfargas/pi-server serve --provider google --model gemini-2.5-flash

# Or install globally:
npm install -g pi-server
pi-server serve --port 3333
```

## License

MIT
