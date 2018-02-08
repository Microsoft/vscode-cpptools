# Natvis - Custom views for native objects

Natvis framework is a framework that allows developers to write custom schemas to help visualize native objects. 

For gdb/lldb debugging (`"type": "cppdbg"`), a subset of the Natvis framework has been ported to the C/C++ extension and the code resides in the [MIEngine](https://github.com/Microsoft/MIEngine) shared component. If additional features that are not implemented are requested, please file an [issue](https://github.com/Microsoft/MIEngine/issues) on the MIEngine GitHub page with details of what is missing.

For Visual C++ debugging (`"type": "cppvsdbg"`), the debugger contains the full implementation of the Natvis framework as Visual Studio. 

## Documentation

Official documentation can be found [here](https://docs.microsoft.com/en-us/visualstudio/debugger/create-custom-views-of-native-objects).

## Schema

The natvis schema can be found [here](natvis.xsd).