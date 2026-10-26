declare module 'sodium-native' {
  const sodium: {
    readonly crypto_secretbox_KEYBYTES: number;
    readonly crypto_secretbox_NONCEBYTES: number;
    readonly crypto_secretbox_MACBYTES: number;
    crypto_generichash(output: Uint8Array, input: Uint8Array, key?: Uint8Array): void;
    crypto_secretbox_easy(output: Uint8Array, message: Uint8Array, nonce: Uint8Array, key: Uint8Array): void;
    crypto_secretbox_open_easy(output: Uint8Array, ciphertext: Uint8Array, nonce: Uint8Array, key: Uint8Array): boolean;
  };
  export default sodium;
}
