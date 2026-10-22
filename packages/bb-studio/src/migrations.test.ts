import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations";

// Released prefix as of 21 October 2026. Never regenerate or edit these hashes.
// New migrations belong at the end of MIGRATIONS in migrations.ts.
const RELEASED_HASHES = [
  "963fbac7411d974a8aa14129053a959339c2a93c494aa38cac49003a64870edc",
  "bcbd92b06b6190f8d8ac91c5458cd88761c138114a93f24370550814ae3e8fa5",
  "4b372a04653bec8b32cddc7365152b2fb021466d453dd724fc639911b60d3834",
  "e728f8854cc9526030c5758a6ee219ac89d0ce3a5431e8ca597203596cdf6946",
  "328e7322e41ce528cc443d0826fa4d5be5e645e84b88223d78a51ffbd33031cd",
  "430a8f0f9f9ec6b09dd7aabcf7079b279935ff5fef0dfd966e454733e2fcd6e1",
  "a5d8e2cca0db590f7f060fa52902751da2f16c1370f523283ff2985ff03b4fce",
  "1860d3749dc3a0942124c8629acb431d32b321b8cdf57455923c881812fb1701",
  "991b718c33627a35075e1a571c79901e3962c96132112e6733746fd6e204899c",
  "89a50b5a147f1c4667076ffcd29fe82437bf91565c4d13024d088466bc2dc99f",
  "6ff6c2f008801bf0c53d1433ab9cc5d66b4601690acf047729dfe34ff043d813",
  "0309d50937941dd3ba3e15e45ba88343ba48439db3d45736d9acb99c41498469",
  "290a02ff91a4997054eb1c1cc6c9b2f6b9b41b9403c093f37506ef5bffe8a3f8",
  "ba2c5343499cc40b9a982f7ca5f9d4547ed13b0923779f086053290954e35162",
  "f1266efd956eb2d05c2f29ed15225454a97fee1714d1830e5cedc76a0162de14",
  "19d81bdcc2925d75efe9ee5ec988327a6bd7dcf6e96777b1b361a45bc8fe20aa",
  "722896a8c824a1ae64f8fec58c462ef7f8d1c304b27e61b43f66206f01a04267",
  "01ba7c6a924e84b6236767b1463a14c47380279cac32ff9df2f5c39109d08fc9",
  "c09da6a98ca887b7ecd35ff04275567ec7de30b6fa2de8ca65816d45bcbb0b36",
  "8ea8d8acd6da5d51b300a8982213c0a7fff20ba46c483d6097658620d445c318",
  "bb5ede5ae5771489200be4aaa744a0b4ddf88896f027adb10728aa7e8f78908d",
  "734124d7710abc93c86639beaee9a45dd26ce4561e54217526d7bbd2d5b0b97b",
  "2187f4f0411e7a7cb0ae7e1142434902a944dba8e2278f0eebf3c2323d779136",
  "ff8b458d7c55c4c2d96ea07694d391697e79b2bb748518e54690875588f4fa99",
  "5a3bbddca42ca5b176bb81a4de0e1c950dd9ecf67aa0947e53d712e0bc524d1b",
  "b2841de5d1ee176c560325dc3cbe82d85170404c13190798bd23bfeb32019535",
  "401b1eb58298f3ff898dae8444dd6919b6e2302760387fb24a7865da05a99512",
  "9682657d735ce7e4fcd0eb19f6bc3e8d98f1837d7f4f0f6a8ac129c92539bf86",
  "96ace1981b8624c7c72bf3b6f2f25108a6302a7359ab13f2f30f9b4a0be62409",
  "dd63980a66fefcd3cdbd835de80bfbdd005b1c1aa97a4ed7086a7f6704527c3d",
  "5a07f30d5cd407dfc6a3855adbd17b36a0b98f0a4e4c1f2f99e900a23e5576b7",
  "8047aa95a8ee8c0fd0bc7c2538f3656cfa8b5e1e4ba6b33af5e826e4d44795a7",
  "bfe2eefb39b75a815f4516f99f8c56f8f52491206c027a824df818dad63a0596",
  "5cb4e71923218d6b50dd38d75045a064c30459f34613416c3248f619dd3cd408",
  "07382190281334d271509741ff04c7a4a1e0511d39629517cc99c8480601b8f3",
  "7840f1d8177240bdcb77011991a6f566ea335382ff1e9da378856f2869eeb869",
  "febc3f9ca79479b3b3d5f4afb02427b9147ae779616dbbdd47a63f789636b78e",
  "89e0265ff448716e15435dc246a8f0098c8d8bfce0628d172f3f899fb5afb1ea",
  "2a17c11dff1ec85ec62e8b67d958c2f0d06317204426018d311301bf27993b3c",
  "67386758e2f17defbf346239264e4ef542d32802c240886704b06f7cd9ab0089",
  "21f3e2275e296bb0e7786a29075d48e23538a4338b72e0ff374c5fa22ca66c79",
  "b0e1a446b39e7e3238d6f2ffb59d3a21471dd8c0f25e54ee501e60c2d948841a",
  "715e9c94e16bb0cda7b5498e30fc3497805cbf68808a0506897e9a697180f890",
  "a2d09047a04bd85c10f717f28c8d61cb4e5dc38d3581c2e67dbf920b46665e90",
  "f0613d78200207e0b069c47a0beaa038fcbd57a5e7c156bfb4fc001c1b5ed517",
  "27486ec899b0dd93b345c480e93543fa070142a31df7f3161c21e05fa9405861",
  "1b65b3e644e07b55b7ae18dcc5013825d32318a54ff19f9a58353cf86cb6d8f9",
  "97d7a46e911ef2fa8423342180c78a51b46072ddc97637085f343c1237c0b619",
  "9f0b15f38c48f6c34be10d42b53ceb9e5ca5fd04496207ab0fdf3f428b1132db",
  "7c8d7ef09de52617ab4f922b9feab7b7025dc152f4b9b9b782fd304e13534393",
  "15ddd61000ffe3b70d6cc2c79c72f2a498caa00a7bd09348d681b1ceca363f52",
  "a504235222ac410cda23cb34c1766111587c7913f77c740a4c40bfe167cc8463",
  "7e0bcdff50106bdac3b9850d22554b20cadbe51b651331fee21ee9c5b8c61237",
  "51d04a91e8c7656c4ee3bfc04cc5e6d0eed1ac758e90cd32a9b424e167366644",
  "4ee0c9c42ad86c916ef5bc1f333192b46133ac586d84c8bab55769422b7c3713",
  "7ef64a4780988e053850049d2b7a5de6d5f165f90ce6666b44773e0a42b8dc2c",
  "25a0e32efa8d325cc131c567f2f735726a09b4a2cb30dfcec93712de63f3a7e9",
  "fa41562f4a961a4645bc08fd0c8b108780aa510ca60ddca89655b2f9093c0fe6",
  "547992e8dff7f4edf6edba53a56b687e4af3366cdde0c658ad863c6970b2c74d",
  "3726fdbab52eeb0160a205df25126167e476224dd1db6db5cc7d495ff870a5bc",
  "e0c9c0156e7d465204a37fcc788a7ce920cc35080b54c5dc265fa83ebef42388",
  "95d5026a4f12aec718c55220302461a59301113933134daf5c1f5d4d20401a61",
  "f7a9f72c1522df02f92846cf6ad8fa1cc7093ce1ac0e7218ea0f8f8ffa6ab8cc",
  "dcf882cd7bc589d94c99d441247c616a8870cbd5c5d24e23cbf9735cd3d7e433",
  "c3a804c350148bd7fcd7eb211a01899c510f092aaebfe60a8e0d6ce753206b71",
  "73f627a36da19e3a76516ce627e623a63e1ce804c52b1849de678d5e08c13093",
  "30a0cd86fc7089f9c875071046316ab51ea599d2e33facf24925574d2104b3f7",
  "d97ec531499ebf84ab9d156a4be4e9475b2ac853e4f6df9b756a4ec97b3aabb5",
  "a61325d4f525ddc80121f87212a0dff484d317d2d19b6e8e37136d5baef3369f",
  "d9f93edb96e7f2ea0e85a0051be778e6430654e7f7911063f165eb6f3b6c1600",
  "14475b57cf034f6325b3ab4696de0dd05bd6509707253b651ebecc8f9550587b",
  "9b585dcb67f39db4c447d656066de61bd14af1a8cd241657dd695e94880163ea",
  "aeff90e9690c70ca6f5d33cce91ad4c68cbbfa8c922a51e2bae644e4dbdf7337",
  "1f89ad09d5e0ccf0fe9c20bd0a72ba6c1259d269efc46b2399bf2ed47395cb4d"
];

describe("migration history", () => {
  it("preserves the count, order and exact SQL of the released prefix", () => {
    expect(RELEASED_HASHES).toHaveLength(74);
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(RELEASED_HASHES.length);
    expect(MIGRATIONS.slice(0, RELEASED_HASHES.length).map((sql) =>
      createHash("sha256").update(sql).digest("hex"),
    )).toEqual(RELEASED_HASHES);
  });

  it("keeps every statement literal so domain changes cannot shift the sequence", () => {
    const source = ts.createSourceFile(
      "migrations.ts",
      readFileSync(new URL("./migrations.ts", import.meta.url), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const declarations = source.statements.filter(ts.isVariableStatement)
      .flatMap((statement) => [...statement.declarationList.declarations]);
    const initializer = declarations.find((declaration) => declaration.name.getText(source) === "MIGRATIONS")?.initializer;
    expect(initializer && ts.isArrayLiteralExpression(initializer)).toBe(true);
    if (!initializer || !ts.isArrayLiteralExpression(initializer)) return;
    expect(initializer.elements.every((entry) =>
      ts.isStringLiteral(entry) || ts.isNoSubstitutionTemplateLiteral(entry),
    )).toBe(true);
    expect(initializer.elements).toHaveLength(MIGRATIONS.length);
  });
});
