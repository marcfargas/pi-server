# pi-serve

> **This is a namespace reservation package.** Install [`@marcfargas/pi-server`](https://www.npmjs.com/package/@marcfargas/pi-server) for the real package.

## Why does this package exist?

This unscoped wrapper exists to prevent supply-chain attacks. Without it, a
malicious actor could publish a package named `pi-serve` on npm. Anyone who
then ran `npx pi-serve` without having installed the scoped package first
would unknowingly execute the attacker's code.

By holding this name, `npx pi-serve` safely delegates to the real
`@marcfargas/pi-server` package.

## License

MIT
