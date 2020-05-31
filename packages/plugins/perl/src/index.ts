import { PluginFunction, Types, PluginValidateFn } from '@graphql-codegen/plugin-helpers';
import { GraphQLSchema, parse, printSchema, visit, concatAST } from 'graphql';
import { PerlPluginRawConfig } from './config';
import { PerlVisitor } from './visitor';
import { extname } from 'path';

export const plugin: PluginFunction<PerlPluginRawConfig> = (
  schema: GraphQLSchema,
  documents: Types.DocumentFile[],
  config: PerlPluginRawConfig,
  { outputFile }
) => {
  const printedSchema = printSchema(schema);
  const astNode = parse(printedSchema);

  const perlVisitor = new PerlVisitor(config, schema);

  const basicTypesResult = visit(astNode, { leave: perlVisitor.typesVisitor(true) })
    .definitions.filter(definition => typeof definition === 'string')
    .join('\n');
  const basicTypes = perlVisitor.buildPluginPackage(basicTypesResult);

  const types = visit(astNode, { leave: perlVisitor.typesVisitor() })
    .definitions.filter(definition => typeof definition === 'string')
    .join('\n');

  const allAst = concatAST(documents.map(v => v.document));
  const allAstResult = visit(allAst, { leave: perlVisitor.typesVisitor() });
  const operations = perlVisitor.buildPluginPackage(
    allAstResult.definitions
      .filter(definition => typeof definition === 'string') // ignore fragments for now
      .join('\n'),
    `${config.packageName}::Operations`
  );

  const content = perlVisitor.wrapWithCLient(basicTypes, types, operations);
  return content;
};

export const validate: PluginValidateFn<any> = async (
  schema: GraphQLSchema,
  documents: Types.DocumentFile[],
  config,
  outputFile: string
) => {
  if (extname(outputFile) !== '.pm') {
    throw new Error(`Plugin "perl requires extension to be ".pm"!`);
  }
};
