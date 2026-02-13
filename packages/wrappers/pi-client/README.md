# pi-client

> **This is a namespace reservation package.** Install [`@marcfargas/pi-client`](https://www.npmjs.com/package/@marcfargas/pi-client) for the real package.

## Why does this package exist?

This unscoped wrapper exists to prevent supply-chain attacks. Without it, a
malicious actor could publish a package named `pi-client` on npm. Anyone who
then ran `npx pi-client` without having installed the scoped package first
would unknowingly execute the attacker's code.

By holding this name, `npx pi-client` safely delegates to the real
`@marcfargas/pi-client` package.

## Usage

```bash
# These all work:
npx pi-client connect ws://localhost:3333
npx @marcfargas/pi-client connect ws://localhost:3333

# Or install globally:
npm install -g pi-client
pi-client connect ws://localhost:3333
```

## License

MIT
