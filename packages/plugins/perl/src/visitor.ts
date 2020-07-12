import { Kind, print, GraphQLSchema } from 'graphql';
import { ParsedConfig, BaseVisitor, buildScalars } from '@graphql-codegen/visitor-plugin-common';
import { PerlPluginRawConfig } from './config';

const PERL_SCALARS = {
  ID: 'Int|Str',
  String: 'Str',
  Int: 'Int',
  Boolean: 'Int',
  Date: 'DateTime',
};

export interface PerlPluginParsedConfig extends ParsedConfig {
  packageName: string;
}

export class PerlVisitor extends BaseVisitor<PerlPluginRawConfig, PerlPluginParsedConfig> {
  constructor(rawConfig: PerlPluginRawConfig, _schema: GraphQLSchema) {
    super(rawConfig, {
      packageName: rawConfig.packageName,
      scalars: buildScalars(_schema, rawConfig.scalars || {}, PERL_SCALARS, 'Object'),
    });
  }

  private mapOperationDefinition(node) {
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
    const operationDef = this.buildOperation({
      query,
      operationName,
      variables,
    });
    return operationDef;
  }

  private mapScalarDefinition(scalarName, scalarClass) {
    if (!scalarClass) {
      return undefined;
    }
    const scalarDef = `
class_type '${scalarName}', { class => '${scalarClass}' };`;
    return scalarDef;
  }

  private mapTypeDefintion(node, type, key, prefix = false) {
    const typeName = node.name.value;
    const typeValues = node[key]
      .map(typeDef => typeDef.name.value)
      .map(typeValue => (prefix ? `${this.config.packageName}::Types::${typeValue}` : typeValue))
      .join(' ');
    const typeDef = `
${type} ${typeName} => [qw/ ${typeValues} /];`;
    return typeDef;
  }

  private getListType(type) {
    if (type.kind === Kind.NON_NULL_TYPE || type.kind === Kind.LIST_TYPE) {
      return this.getListType(type.type);
    }

    return type.name.value;
  }

  private getFieldType(field) {
    if (field.type.kind === Kind.NON_NULL_TYPE) {
      return this.getFieldType(field.type);
    }

    if (field.type.kind === Kind.LIST_TYPE) {
      return [this.getListType(field.type), true];
    }
    return [field.type.name.value, false];
  }

  private mapPackageDefintion(node) {
    const typeName = node.name.value;
    let extensions;
    if (node.interfaces && node.interfaces.length > 0) {
      const parents = node.interfaces
        .map(_interface => _interface.name.value)
        .map(parent => `${this.config.packageName}::Types::${parent}`);
      extensions = this.buildExtensions({ parents });
    }

    const attributes = node.fields.map(field => {
      const name = field.name.value;
      const isRequired = field.type.kind === Kind.NON_NULL_TYPE;
      const [type, isList] = this.getFieldType(field);

      return this.buildAttribute({
        name,
        type: this.config.scalars[type] ? this.config.scalars[type].type : `${this.config.packageName}::Types::${type}`,
        isList,
        isRequired,
      });
    });

    const typePackage = this.buildTypePackage({
      name: typeName,
      attributes: attributes.join(''),
      builders: [],
      extensions: extensions || null,
    });

    return typePackage;
  }

  private buildExtensions({ parents }) {
    return `
extends ${parents.map(parent => `'${parent}'`).join(', ')};`;
  }

  buildTypePackage({ name, extensions, attributes, builders }) {
    return `package ${this.config.packageName}::Types::${name};

use Moose;
${attributes ? 'use Moose::Util::TypeConstraints;' : ''}
with '${this.config.packageName}::Types::Roles';
${extensions || ''}
${attributes || ''}
${builders || ''}
no Moose;
${attributes ? 'no Moose::Util::TypeConstraints;' : ''}

1;`;
  }

  private buildAttribute({ name, type, isList, isRequired, builder }: Record<string, string | boolean>) {
    return `
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
);`;
  }

  buildPluginPackage = (content: string, packageName?: string) => {
    return `package ${packageName || this.config.packageName};

use Moose;
use Moose::Util::TypeConstraints;

${content}

no Moose::Util::TypeConstraints;
no Moose;

1;`;
  };

  buildOperation(operationProps) {
    return `
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
}`;
  }

  typesVisitor(onlyBasicTypes = false) {
    return {
      ...(onlyBasicTypes
        ? {
            ScalarTypeDefinition: node => {
              return this.mapScalarDefinition(node.name.value, this.config.scalars[node.name.value].type || '');
            },
            EnumTypeDefinition: node => {
              return this.mapTypeDefintion(node, 'enum', 'values');
            },
            UnionTypeDefinition: node => {
              return this.mapTypeDefintion(node, 'union', 'types', true);
            },
          }
        : {
            InterfaceTypeDefinition: node => {
              return this.mapPackageDefintion(node);
            },
            ObjectTypeDefinition: node => {
              return this.mapPackageDefintion(node);
            },
            InputObjectTypeDefinition: node => {
              return this.mapPackageDefintion(node);
            },
            OperationDefinition: node => {
              return this.mapOperationDefinition(node);
            },
          }),
    };
  }

  wrapWithCLient(basicTypes: string, types: string, operations: string) {
    return `${basicTypes}

package ${this.config.packageName}::Types::Roles;

use Moose::Role;

sub as_hash {
    my $self = shift;
    my @attributes = $self->meta->get_all_attributes;
    my %hash = map {
        my $value  = $self->meta->get_attribute($_->name)->get_value($self);
        $value ? ($_->name => $value) : ()
    } @attributes;
    return \\%hash;
}

no Moose::Role;

1;

${types}

${operations}

package ${this.config.packageName}::Client;

use Moose;
use LWP::UserAgent;
use HTTP::Request ();
use JSON::MaybeXS qw(encode_json decode_json);

has 'url' => (
    is => 'ro',
    isa => 'Str',
    required => 1,
);

has 'headers' => (
    is => 'ro',
    isa => 'HashRef',
    required => 0,
    default => sub { {} },
);

my $class_type_maps;
sub BUILD {
    my $self = shift;
    $class_type_maps = {
        %{ $self->_retrieve_class_type_maps('${this.config.packageName}::Types::Query') || {} },
        %{ $self->_retrieve_class_type_maps('${this.config.packageName}::Types::Mutation') || {} },
    };
}

sub send {
    my ($self, $query) = @_;

    my $headers = [
        'Content-Type' => 'application/json; charset=UTF-8',
        %{ $self->headers },
    ];
    my $request = HTTP::Request->new(
        'POST',
        $self->url,
        $headers,
        encode_json($query)
    );
    my $user_agent = LWP::UserAgent->new();
    my $response = $user_agent->request($request);

    unless ( $response->is_success ) {
        my $message = $response->message || "No error messages";
        die sprintf(
            "%s request error \nStatus: %s \nRequest failed due to:\n\t%s",
            __PACKAGE__,
            $response->code,
            $response->message || "No error messages",
        );
    }

    my $content = $response->decoded_content;
    my $data = decode_json $content;
    my $result = $self->_parse_data($data->{data});
    return $result;
}

sub _parse_data {
    my ($self, $data, $parent_type) = @_;
    my $parsed_data = {};

    for my $key (keys %$data) {
        my $value = $data->{ $key };
        my $type;
        if ($class_type_maps->{$key}) {;
            $type = $class_type_maps->{$key};
        } else {
            my $_class_type_map = $self->_retrieve_class_type_maps($parent_type);
            $type = $_class_type_map->{$key};
        }

        if (ref($value) eq 'ARRAY') {
            ($type) = $type =~ /^ArrayRef\\[(.*)\\]$/g;
            my @values = map { $self->_resolve_value($type, $_) } @$value;
            $parsed_data->{ $key } = [@values];
        } elsif (ref($value) eq 'HASH') {
            my %values;
            for my $_key (keys %$value) {
                my $_value = $value->{$_key};
                if ( ref($_value) eq 'HASH' ) {
                    %values = (
                        %values,
                        %{ $self->_parse_data({ $_key => $_value }, $type) },
                    );
                } else {
                    if (ref($_value) eq 'ARRAY') {
                        %values = (
                            %values,
                            %{ $self->_parse_data({ $_key => $_value }, $type) },
                        );
                    } else {
                        $values{$_key} = $_value;
                    }
                }
            }

            $parsed_data->{ $key } = $self->_resolve_value($type, \\%values);
        } else {
            $parsed_data->{ $key } = $self->_resolve_value($type, $value);
        }
    }
    return $parsed_data;
}

sub _resolve_value {
    my ($self, $type, $value) = @_;

    my @attributes = map { $_ => $value->{$_} } keys %{ $value };
    return $type->new(@attributes);
}

sub _retrieve_class_type_maps {
    my ($self, $class) = @_;

    return {} unless $class;
    return {} unless $class->can('meta');

    my @attributes = $class->meta->get_all_attributes;
    my %class_type_maps = map {
        $class->can('meta') ? (
            $_->name => $class->meta->get_attribute($_->name)->type_constraint->name
        ) : ()
    } @attributes;

    return \\%class_type_maps;
}

no Moose;

1;`;
  }
}
