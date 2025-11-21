// TokenFactory contract ABI and utilities
// Contract: 0x5a5225c2048707734d445d87532a5d442c8A6eA1
// Implementation: 0x52e4d83d25dea4a77350a12407eb72ac82a3ea83

export const TOKEN_FACTORY_ADDRESS = "0x5a5225c2048707734d445d87532a5d442c8A6eA1";

// Complete verified ABI from BaseScan
export const TOKEN_FACTORY_ABI = [
  {
    inputs: [],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [],
    name: "InvalidAPIURL",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidNameOrSymbol",
    type: "error",
  },
  {
    inputs: [],
    name: "SubscriptionFeeTooHigh",
    type: "error",
  },
  {
    inputs: [],
    name: "TokenAlreadyExists",
    type: "error",
  },
  {
    inputs: [],
    name: "ZeroAddressNotAllowed",
    type: "error",
  },
  {
    inputs: [],
    name: "ZeroBuilder",
    type: "error",
  },
  {
    inputs: [],
    name: "ZeroMaxSubscriptionFee",
    type: "error",
  },
  {
    inputs: [],
    name: "ZeroSubscriptionTokenAmount",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint8",
        name: "version",
        type: "uint8",
      },
    ],
    name: "Initialized",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "account",
        type: "address",
      },
    ],
    name: "Paused",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "maxSubscriptionFee",
        type: "uint256",
      },
    ],
    name: "SetMaxSubscriptionFee",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "string",
        name: "endpoint",
        type: "string",
      },
      {
        indexed: true,
        internalType: "address",
        name: "builder",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "token",
        type: "address",
      },
    ],
    name: "TokenCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "tokenImplementation",
        type: "address",
      },
    ],
    name: "TokenImplementationSet",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "account",
        type: "address",
      },
    ],
    name: "Unpaused",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "hyperpieConfig",
        type: "address",
      },
    ],
    name: "UpdatedHyperpieConfig",
    type: "event",
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "string",
            name: "name",
            type: "string",
          },
          {
            internalType: "string",
            name: "symbol",
            type: "string",
          },
          {
            internalType: "string",
            name: "apiURL",
            type: "string",
          },
          {
            internalType: "address",
            name: "builder",
            type: "address",
          },
          {
            internalType: "address",
            name: "paymentToken",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "subscriptionFee",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "subscriptionTokenAmount",
            type: "uint256",
          },
        ],
        internalType: "struct IIAOTokenFactory.CreateTokenParams",
        name: "params",
        type: "tuple",
      },
    ],
    name: "createToken",
    outputs: [
      {
        internalType: "address",
        name: "tokenAddress",
        type: "address",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "string",
        name: "apiURL",
        type: "string",
      },
    ],
    name: "getToken",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "hyperpieConfig",
    outputs: [
      {
        internalType: "contract IHyperpieConfig",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_hyperpieConfig",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "_maxSubscriptionFee",
        type: "uint256",
      },
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "maxSubscriptionFee",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "pause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "paused",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "_maxSubscriptionFee",
        type: "uint256",
      },
    ],
    name: "setMaxSubscriptionFee",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_tokenImp",
        type: "address",
      },
    ],
    name: "setTokenImplementation",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "tokenImp",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "unpause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_hyperpieConfig",
        type: "address",
      },
    ],
    name: "updateConfig",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

