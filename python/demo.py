
import sys
sys.path.insert(0, './build')

from example import add, Pet
print(add(2, 3))
my_dog = Pet('Pluto', 5)
print(my_dog.get_name())

assert my_dog.get_name() == 'Pluto'
assert my_dog.get_hunger() == 5
my_dog.go_for_a_walk()
assert my_dog.get_hunger() == 6
