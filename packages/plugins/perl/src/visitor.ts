import { Kind, print } from 'graphql';

// console.dump = obj => console.log(require('util').inspect(obj, false, null, true /* enable colors */));

let packageName;

export const visitor = (basic = false) => config => {
  const { scalars } = config;

  packageName = config.packageName;

  return {
    ...(basic
      ? {
          ScalarTypeDefinition: node => mapScalarDefinition(node.name.value, scalars[node.name.value] || ''),
          EnumTypeDefinition: node => mapTypeDefintion(node, 'enum', 'values'),
          UnionTypeDefinition: node => mapTypeDefintion(node, 'union', 'types', true),
        }
      : {
          InterfaceTypeDefinition: node => mapPackageDefintion(node, scalars),
          ObjectTypeDefinition: node => mapPackageDefintion(node, scalars),
          InputObjectTypeDefinition: node => mapPackageDefintion(node, scalars),
          OperationDefinition: node => mapOperationDefinition(node),
          // FieldDefinition: node => console.debug(node),
          // FragmentDefinition: node => console.debug(node),
        }),
  };
};

const mapOperationDefinition = node => {
  const operationName = node.name.value;
  const query = print(node);
  const variables = node.variableDefinitions.map(variableDefinition => ({
    isRequired: variableDefinition.type.kind === Kind.NON_NULL_TYPE,
    name: variableDefinition.variable.name.value,
    type:
      variableDefinition.type.kind === Kind.NON_NULL_TYPE
        ? variableDefinition.type.type.name.value
        : variableDefinition.type.name.value,
  }));
  const operationDef = buildOperation({
    query,
    operationName,
    variables,
  });
  return operationDef;
};

const mapScalarDefinition = (scalarName, scalarClass) => {
  if (!scalarClass) {
    return undefined;
  }
  const scalarDef = `class_type '${scalarName}', { class => '${scalarClass}' };`;
  //   console.log(scalarDef);
  return scalarDef;
};

const mapTypeDefintion = (node, type, key, prefix = false) => {
  //   console.dump(node);
  const typeName = node.name.value;
  const typeValues = node[key]
    .map(typeDef => typeDef.name.value)
    .map(typeValue => (prefix ? `${packageName}::${typeValue}` : typeValue))
    .join(' ');
  const typeDef = `${type} ${typeName} => [qw/ ${typeValues} /];`;
  //   console.log(typeDef);
  return typeDef;
};

const mapPackageDefintion = (node, scalars) => {
  //   console.dump(node);
  const typeName = node.name.value;
  let extensions;
  if (node.interfaces && node.interfaces.length > 0) {
    const parents = node.interfaces.map(_interface => _interface.name.value).map(parent => `${packageName}::${parent}`);
    extensions = buildExtensions({ parents });
    //   console.log(extensions);
  }

  // const buildersByAttribute = node.fields
  //   .filter(node => node.arguments && node.arguments.length)
  //   .reduce((_, field) => {
  //     const name = field.name.value;
  //     const props = field.arguments.map(argument => ({
  //       name: argument.name.value,
  //       isRequired: argument.type.kind === Kind.NON_NULL_TYPE,
  //       defaultValue: argument.defaultValue,
  //     }));
  //     return { ..._, [name]: [...props] };
  //   }, {});
  // console.log(buildersByAttribute);

  const getListType = type => {
    if (type.kind === Kind.NON_NULL_TYPE || type.kind === Kind.LIST_TYPE) {
      return getListType(type.type);
    }

    return type.name.value;
  };

  const getFieldType = field => {
    if (field.type.kind === Kind.NON_NULL_TYPE) {
      return getFieldType(field.type);
    }

    if (field.type.kind === Kind.LIST_TYPE) {
      return [getListType(field.type), true];
    }
    return [field.type.name.value, false];
  };

  const attributes = node.fields.map(field => {
    const name = field.name.value;
    const isRequired = field.type.kind === Kind.NON_NULL_TYPE;
    const [type, isList] = getFieldType(field);

    return buildAttribute({
      name,
      type: scalars[type] ? scalars[type] : `${packageName}::${type}`,
      isList,
      isRequired,
      // builder: buildersByAttribute[name],
    });
  });
  // const builders = Object.keys(buildersByAttribute).map(attribute =>
  //   buildAttributeBuilder(attribute, buildersByAttribute[attribute])
  // );

  const typePackage = buildPackage({
    packageName,
    name: typeName,
    attributes: attributes.join(''),
    // builders: builders.join(''),
    builders: [],
    extensions: extensions || null,
  });

  // console.log(typePackage);

  return typePackage;
};

const buildExtensions = ({ parents }) => `
extends ${parents.map(parent => `'${parent}'`).join(', ')};`;

const buildPackage = ({ packageName, name, extensions, attributes, builders }) => `
package ${packageName}::${name};

use Moose;
${attributes ? 'use Moose::Util::TypeConstraints;' : ''}
with '${packageName}::Roles';
${extensions || ''}
${attributes || ''}
${builders || ''}
no Moose;
${attributes ? 'no Moose::Util::TypeConstraints;' : ''}

1;
`;

const buildAttribute = ({ name, type, isList, isRequired, builder }: Record<string, string | boolean>) => `
has '${name}' => (
    is => 'ro',
    ${type ? `isa => ${isList ? `'ArrayRef[${type}]'` : `'${type}'`},` : ''}
    required => ${isRequired ? 1 : 0}${
  builder
    ? `,
    builder => _build_${name},
    lazy => 1`
    : ''
}
);
`;

// const buildAttributeBuilder = (name, builderProps) => `
// sub _build_${name} {
//     my ($self, ${builderProps.map(prop => `$${prop.name}`).join(', ')}) = @_;
//     ${builderProps
//       .filter(prop => prop.isRequired && !prop.defaultValue)
//       .map(prop => `die "Property '$${prop.name}' is required" unless ($${prop.name});`)
//       .join('\n')}

//     ${builderProps
//       .filter(prop => prop.defaultValue)
//       .map(prop => `$${prop.name} = $${prop.defaultValue}; unless ($${prop.name});`)
//       .join('\n')}

//     # what do I return tho?!
//     return undef;
// }
// `;

export const buildPluginPackage = (packageName: string, content) => `
package ${packageName};

use Moose;
use Moose::Util::TypeConstraints;

${content}

no Moose::Util::TypeConstraints;
no Moose;

1;
`;

const buildOperation = operationProps => `
sub ${operationProps.operationName} {
    my ($self, ${operationProps.variables.map(prop => `$${prop.name}`).join(', ')}) = @_;
    ${operationProps.variables
      .filter(prop => prop.isRequired)
      .map(prop => `die "Property '$${prop.name}' is required" unless ($${prop.name});`)
      .join('\n')}
    return {
      query => qq[
${operationProps.query.replace(/\$/g, '\\$')}
      ],
      operationName => '${operationProps.operationName}',
      variables => { ${operationProps.variables
        .map(prop => `${prop.name} => $${prop.name}->can('as_hash') ? $${prop.name}->as_hash : $${prop.name}`)
        .join(',\n')} },
    };
}
`;
