import { RawConfig } from '@graphql-codegen/visitor-plugin-common';
export interface PerlPluginRawConfig extends RawConfig {
  /**
   * @name packageName
   * @type string
   * @default Types
   * @description Allow you to customize the parent package name.
   *
   * @example
   * ```yml
   * generates:
   *   src/main/c-sharp/my-org/my-app/MyGeneratedTypes.pl:
   *     plugins:
   *       - cperl
   *     config:
   *       packageName: My::Package::Name
   * ```
   */
  packageName?: string;
  /**
   * @name scalars
   * @type string
   * @default Types
   * @description Allow you to customize the parent class name.
   *
   * @example
   * ```yml
   * generates:
   *   src/main/c-sharp/my-org/my-app/MyGeneratedTypes.pl:
   *     plugins:
   *       - cperl
   *     config:
   *       scalars:
   *        ID: Int|Str
   *        String: Str
   * ```
   */
  scalars?: Record<string, string>;
}
