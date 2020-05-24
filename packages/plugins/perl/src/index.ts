import { PluginFunction, Types, PluginValidateFn } from '@graphql-codegen/plugin-helpers';
import { GraphQLSchema, parse, printSchema, visit, concatAST } from 'graphql';
import { PerlPluginRawConfig } from './config';
import { visitor, buildPluginPackage } from './visitor';
import { extname } from 'path';

export const plugin: PluginFunction<PerlPluginRawConfig> = (
  schema: GraphQLSchema,
  documents: Types.DocumentFile[],
  config: PerlPluginRawConfig,
  { outputFile }
) => {
  const printedSchema = printSchema(schema);
  const astNode = parse(printedSchema);

  const { packageName } = config;

  const basicTypes = visit(astNode, {
    leave: visitor(true)({ ...config, packageName: `${packageName}::Types` }),
  })
    .definitions.filter(definition => typeof definition === 'string')
    .join('\n\n');
  // console.log(basicTypes);

  const types = visit(astNode, { leave: visitor()({ ...config, packageName: `${packageName}::Types` }) })
    .definitions.filter(definition => typeof definition === 'string')
    .join('\n');
  // console.log(types);

  const allAst = concatAST(documents.map(v => v.document));
  const allAstResult = visit(allAst, { leave: visitor()(config) });
  const operations = buildPluginPackage(
    `${packageName}::Operations`,
    allAstResult.definitions.filter(definition => typeof definition === 'string').join('\n') // ignore fragments
  );
  // console.log(operations);

  // [...result.definitions, operations]
  //   .filter(definition => typeof definition === 'string' && /^package\s*(.*);+$/m.test(definition))
  //   .map(definition => {
  //     const [, definitionPackage] = definition.match(/^package\s*(.*);+$/m);
  //     const filePath = `${__dirname}/out/${definitionPackage.split('::').join('/')}.pm`;
  //     console.log(filePath);
  //     require('fs-extra').outputFile(filePath, definition, error => {
  //       if (error) {
  //         console.error(error);
  //       } else {
  //         // console.log(`file saved: ${filePath}`);
  //       }
  //     });
  //   });

  const content = `
${buildPluginPackage(packageName, basicTypes)}

package ${packageName}::Types::Roles;

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

package ${packageName}::Client;

use Moose;

use LWP::UserAgent; 
use HTTP::Request ();
use JSON::MaybeXS qw(encode_json decode_json);

use Data::Printer;

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
        %{ $self->_retrieve_class_type_maps('${packageName}::Types::Query') || {} },
        %{ $self->_retrieve_class_type_maps('${packageName}::Types::Mutation') || {} },
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

    unless ($response->is_success) {
        die "It failed";
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

1;

`;
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
