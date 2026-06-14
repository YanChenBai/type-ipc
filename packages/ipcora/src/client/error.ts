export class ClientIpcError<TName extends string = string, TData = unknown> extends Error {
  readonly data?: TData;

  constructor(
    name: TName,
    options: {
      message?: string;
      data?: TData;
      stack?: string;
    } = {},
  ) {
    super(options.message ?? name);
    this.name = name;
    this.data = options.data;
    if (options.stack) {
      this.stack = options.stack;
    }
  }
}
