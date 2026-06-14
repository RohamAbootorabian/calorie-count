/// <reference types="expo/types" />
/// <reference types="nativewind/types" />

// NativeWind / CSS imports used by the web build. Committed here (rather than in
// the auto-generated, git-ignored expo-env.d.ts) so the declarations survive
// Expo regenerating its types and are shared across the team.
declare module "*.css";
declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
