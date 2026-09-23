/** CSS Modules resolve to a class-name map; the bundler supplies the values. */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
